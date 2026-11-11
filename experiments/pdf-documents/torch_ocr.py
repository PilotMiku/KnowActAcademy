"""Equivalent local formula inference with cached decoder states on Apple GPU."""
import json
import math
from pathlib import Path
import time
import numpy as np
from PIL import Image
import torch
from safetensors.torch import load_file
from transformers import VisionEncoderDecoderConfig,VisionEncoderDecoderModel,TrOCRProcessor

ROOT=Path(__file__).resolve().parents[2]
CACHE=ROOT/'.cache/pdf-transcription'


class TorchFormulaOCR:
    def __init__(self,threads=2,half=False):
        torch.set_num_threads(threads)
        if not torch.backends.mps.is_available():raise RuntimeError('Apple GPU is unavailable in this process')
        directory=CACHE/'models/mfr-1.5'
        proof=json.loads((directory/'torch-equivalence.json').read_text())
        if not proof.get('equivalent'):raise ValueError('Recovered weights were not validated')
        config=VisionEncoderDecoderConfig.from_pretrained(directory,local_files_only=True)
        config.encoder._attn_implementation='eager';config.decoder._attn_implementation='eager'
        self.model=VisionEncoderDecoderModel(config=config)
        self.model.load_state_dict(load_file(str(directory/'recovered-model.safetensors')))
        self.dtype=torch.float16 if half else torch.float32
        self.model=self.model.eval().to(device='mps',dtype=self.dtype)
        self.processor=TrOCRProcessor.from_pretrained(directory,local_files_only=True,use_fast=False)

    def recognize_generate(self,paths,max_tokens=384):
        images=[]
        for path in paths:
            refined=CACHE/'refined-crops'/Path(path).name
            if refined.exists():path=refined
            with Image.open(path) as image:images.append(image.convert('RGB'))
        pixels=self.processor(images=images,return_tensors='pt').pixel_values.to(device='mps',dtype=self.dtype)
        with torch.inference_mode():
            result=self.model.generate(pixel_values=pixels,decoder_start_token_id=1,
                                       bos_token_id=1,eos_token_id=2,pad_token_id=0,
                                       max_new_tokens=max_tokens,do_sample=False,num_beams=1,
                                       use_cache=True,return_dict_in_generate=True,output_scores=True)
            probabilities=torch.stack(result.scores,dim=1).log_softmax(dim=-1)
            selected=probabilities.gather(2,result.sequences[:,1:,None]).squeeze(-1).cpu().numpy()
        sequences=result.sequences.cpu().tolist()
        texts=self.processor.batch_decode(sequences,skip_special_tokens=True)
        rows=[]
        for index,(tokens,text) in enumerate(zip(sequences,texts)):
            try:length=tokens.index(2,1);truncated=False
            except ValueError:length=len(tokens)-1;truncated=True
            scores=selected[index,:length]
            rows.append({'text':text.strip(),'confidence':float(np.exp(scores.mean())),
                         'minimumTokenConfidence':float(np.exp(scores.min())),
                         'tokens':int(length),'truncated':truncated})
        return rows

    def recognize(self,paths,max_tokens=384):
        images=[]
        for path in paths:
            refined=CACHE/'refined-crops'/Path(path).name
            if refined.exists():path=refined
            with Image.open(path) as image:images.append(image.convert('RGB'))
        pixels=self.processor(images=images,return_tensors='pt').pixel_values.to(device='mps',dtype=self.dtype)
        sequences=[[1] for _ in paths];scores=[[] for _ in paths];finished=[False for _ in paths]
        active=list(range(len(paths)))
        with torch.inference_mode():
            hidden=self.model.encoder(pixels).last_hidden_state
            tokens=torch.ones((len(paths),1),dtype=torch.long,device='mps');past=None
            for _ in range(max_tokens):
                output=self.model.decoder(input_ids=tokens,encoder_hidden_states=hidden,
                                          past_key_values=past,use_cache=True)
                logits=output.logits[:,-1,:]
                values,predicted=logits.log_softmax(dim=-1).max(dim=-1)
                step=torch.stack([predicted.float(),values],dim=-1).cpu().numpy()
                keep=[]
                for row,original in enumerate(active):
                    token=int(step[row,0]);sequences[original].append(token);scores[original].append(float(step[row,1]))
                    if token==2:finished[original]=True
                    else:
                        sequence=sequences[original]
                        repeated=False
                        if len(sequence)>80 and np.mean(scores[original][-40:])<-.005:
                            for width in range(4,17):
                                if all(sequence[-width:]==sequence[-width*(k+1):-width*k] for k in range(1,5)):
                                    repeated=True;break
                        # Repetition is an abstention (truncated), never an
                        # invented completion. This bounds pathological blank OCR.
                        if not repeated:keep.append(row)
                if not keep:break
                next_tokens=predicted[:,None]
                past=output.past_key_values
                if len(keep)!=len(active):
                    indices=torch.tensor(keep,dtype=torch.long,device='mps')
                    hidden=hidden.index_select(0,indices)
                    tokens=next_tokens.index_select(0,indices)
                    past=tuple(tuple(value.index_select(0,indices) for value in layer) for layer in past)
                    active=[active[i] for i in keep]
                else:tokens=next_tokens
        texts=self.processor.batch_decode(sequences,skip_special_tokens=True)
        return [{'text':text.strip(),'confidence':float(np.exp(np.mean(values))),
                 'minimumTokenConfidence':float(np.exp(min(values))),
                 'tokens':len(values),'truncated':not finished[index]}
                for index,(text,values) in enumerate(zip(texts,scores))]


if __name__=='__main__':
    records=[json.loads(s) for s in (CACHE/'recognition.jsonl').read_text().splitlines()][-64:]
    paths=[CACHE/'crops'/(r['id']+'.png') for r in records]
    model=TorchFormulaOCR(half=True)
    reference=model.recognize_generate(paths[:8]);actual=model.recognize(paths[:8])
    identical=sum(a['text']==b['text'] for a,b in zip(reference,actual))
    print(json.dumps({'referenceCases':8,'identicalGreedyTranscriptions':identical}),flush=True)
    start=time.monotonic();result=model.recognize(paths)
    print(json.dumps({'half':True,'batch':len(paths),'seconds':round(time.monotonic()-start,3),
                      'tokens':[r['tokens'] for r in result],'truncated':sum(r['truncated'] for r in result)}),flush=True)
