"""Local ONNX formula OCR with resumable, per-formula confidence records.

Calls the published encoder/decoder directly to avoid training-library version
coupling. It never sends source images over the network.
"""
import argparse
import json
import math
import os
from pathlib import Path
import time

os.environ['TOKENIZERS_PARALLELISM'] = 'false'
os.environ['HF_HUB_OFFLINE'] = '1'
import numpy as np
import onnxruntime as ort
from PIL import Image
from transformers import TrOCRProcessor

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / '.cache/pdf-transcription'


class FormulaOCR:
    def __init__(self, threads=4, quantized=False):
        directory = CACHE / 'models/mfr-1.5'
        self.processor = TrOCRProcessor.from_pretrained(directory, local_files_only=True,
                                                       use_fast=False)
        options = ort.SessionOptions()
        options.intra_op_num_threads = threads
        options.inter_op_num_threads = 1
        suffix='.int8.onnx' if quantized else '.onnx'
        self.encoder = ort.InferenceSession(str(directory / ('encoder_model'+suffix)),
                                            sess_options=options, providers=['CPUExecutionProvider'])
        self.decoder = ort.InferenceSession(str(directory / ('decoder_model'+suffix)),
                                            sess_options=options, providers=['CPUExecutionProvider'])

    def recognize(self, paths, max_tokens=512):
        images = []
        for path in paths:
            refined=CACHE/'refined-crops'/Path(path).name
            if refined.exists():path=refined
            with Image.open(path) as image:
                images.append(image.convert('RGB'))
        pixels = self.processor(images=images, return_tensors='np').pixel_values
        hidden = self.encoder.run(None, {'pixel_values': pixels})[0]
        tokens = np.ones((len(paths), 1), dtype=np.int64)
        active = list(range(len(paths)))
        sequences = [[1] for _ in paths]
        done = [False for _ in paths]
        log_scores = [[] for _ in paths]
        max_aspect = max(image.width / image.height for image in images)
        max_tokens = min(max_tokens, max(192, math.ceil(max_aspect * 12 + 24)))
        for _ in range(max_tokens):
            logits = self.decoder.run(None, {'input_ids': tokens,
                                            'encoder_hidden_states': hidden})[0][:, -1, :]
            predicted = logits.argmax(axis=-1)
            shifted = logits - logits.max(axis=-1, keepdims=True)
            log_probs = shifted - np.log(np.exp(shifted).sum(axis=-1, keepdims=True))
            for row, original in enumerate(active):
                log_scores[original].append(float(log_probs[row, predicted[row]]))
                sequences[original].append(int(predicted[row]))
                done[original] = predicted[row] == 2
            tokens = np.concatenate([tokens, predicted[:, None]], axis=1)
            keep = [i for i, token in enumerate(predicted) if token != 2]
            if not keep:
                break
            tokens = tokens[keep]
            hidden = hidden[keep]
            active = [active[i] for i in keep]
        texts = self.processor.batch_decode(sequences, skip_special_tokens=True)
        return [{'text': text.strip(),
                 'confidence': math.exp(sum(scores) / max(1, len(scores))),
                 'minimumTokenConfidence': math.exp(min(scores)) if scores else 0,
                 'tokens': len(scores), 'truncated': not bool(done[row])}
                for row, (text, scores) in enumerate(zip(texts, log_scores))]


def pending_ids():
    ids = set()
    for path in (CACHE / 'documents').glob('*.json'):
        document = json.loads(path.read_text())
        ids.update(node['id'] for q in document['questions'] for nodes in q['parts'].values()
                   for node in nodes if node['kind'] == 'formula')
    compounds=CACHE/'compound-formulas.json'
    if compounds.exists():
        groups=json.loads(compounds.read_text())
        ids-=set(groups)
        ids.update(child for children in groups.values() for child in children)
    return ids


def segmentation_complete():
    directory=ROOT/'.cache/supplement-transcription'
    inventory=directory/'inventory.json';segments=directory/'segments.jsonl'
    if not inventory.exists() or not segments.exists():return False
    expected={row['id'] for row in json.loads(inventory.read_text())['images'] if not row.get('decodeError')}
    originals=directory/'original-raster-parts.json'
    if originals.exists():expected.update(row['imageId'] for row in json.loads(originals.read_text())['parts'])
    actual={json.loads(line)['id'] for line in segments.read_text().splitlines()}
    return expected<=actual


def main(batch_size=8, limit=None, threads=4, quantized=False, mps=False, supplements=False):
    results = CACHE / 'recognition.jsonl'
    seen = set()
    if results.exists():
        for line in results.read_text().splitlines():
            record = json.loads(line)
            seen.add(record['id'])
    pending = pending_ids()
    if supplements:
        for name in ['segments.jsonl','segments-overrides.jsonl','segments-reading-order-v2.jsonl']:
            source=ROOT/'.cache/supplement-transcription'/name
            if source.exists():
                for line in source.read_text().splitlines():
                    record=json.loads(line)
                    pending.update(n['id'] for n in record['nodes'] if n['kind']=='formula')
        blank_path=ROOT/'.cache/supplement-transcription/blank-formulas.json'
        if blank_path.exists():
            blanks=json.loads(blank_path.read_text());pending-=set(blanks)
            pending.update(row['prefixId'] for row in blanks.values() if row['prefixId'])
    audit = CACHE / 'formula-audit.jsonl'
    approved = set()
    if audit.exists():
        for line in audit.read_text().splitlines():
            record=json.loads(line)
            if record.get('passed'):approved.add(record['id'])
    aliases_path=CACHE/'formula-aliases.json'
    aliases=json.loads(aliases_path.read_text()) if aliases_path.exists() else {}
    approved_shapes={aliases.get(fid,fid) for fid in approved}
    candidates={aliases.get(fid,fid) for fid in pending-seen-approved
                if aliases.get(fid,fid) not in approved_shapes}
    ids = list(candidates-seen)
    # Similar aspect ratios tend to have similar sequence lengths.
    def aspect(fid):
        with Image.open(CACHE / 'crops' / (fid + '.png')) as bitmap:
            return bitmap.width / bitmap.height
    ids.sort(key=aspect)
    if limit:
        ids = ids[:limit]
    print(json.dumps({'cached': len(seen), 'pending': len(ids)}), flush=True)
    if not ids:return 0
    if mps:
        from torch_ocr import TorchFormulaOCR
        model=TorchFormulaOCR(threads=min(threads,2),half=True)
    else:model = FormulaOCR(threads=threads,quantized=quantized)
    start = time.monotonic()
    with results.open('a', encoding='utf-8') as output:
        for begin in range(0, len(ids), batch_size):
            batch = ids[begin:begin + batch_size]
            recognized = model.recognize([CACHE / 'crops' / (fid + '.png') for fid in batch])
            for fid, record in zip(batch, recognized):
                model_name='mfr-1.5-mps-fp16' if mps else 'mfr-1.5-int8' if quantized else 'mfr-1.5-fp32'
                output.write(json.dumps({'id': fid, 'model':model_name, **record}, ensure_ascii=False) + '\n')
            output.flush()
            completed = begin + len(batch)
            elapsed = time.monotonic() - start
            print(json.dumps({'completed': completed, 'total': len(ids),
                              'seconds': round(elapsed, 1),
                              'perFormulaSeconds': round(elapsed / completed, 3),
                              'last': recognized[-1]}, ensure_ascii=False), flush=True)
    return len(ids)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--batch-size', type=int, default=8)
    parser.add_argument('--limit', type=int)
    parser.add_argument('--threads', type=int, default=4)
    parser.add_argument('--quantized',action='store_true')
    parser.add_argument('--mps',action='store_true')
    parser.add_argument('--supplements',action='store_true')
    parser.add_argument('--watch',action='store_true',help='Continue as supplementary segmentation produces new crops')
    args = parser.parse_args()
    while True:
        processed=main(args.batch_size, args.limit, args.threads, args.quantized,args.mps,args.supplements)
        if not args.watch:break
        if not processed and segmentation_complete():break
        if not processed:time.sleep(10)
