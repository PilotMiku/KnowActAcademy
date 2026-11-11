"""Recover named public model tensors for equivalent cached GPU inference.

Only proceeds if every used parameter is accounted for and CPU forward outputs
numerically agree with the published ONNX model. No retraining or guessing.
"""
import json
from pathlib import Path
import numpy as np
import onnx
from onnx import numpy_helper
import onnxruntime as ort
from PIL import Image
from safetensors.torch import save_file
import torch
from transformers import VisionEncoderDecoderConfig,VisionEncoderDecoderModel,TrOCRProcessor

ROOT=Path(__file__).resolve().parents[2]
DIRECTORY=ROOT/'.cache/pdf-transcription/models/mfr-1.5'


def recover():
    torch.set_num_threads(2)
    config=VisionEncoderDecoderConfig.from_pretrained(DIRECTORY,local_files_only=True)
    config.encoder._attn_implementation='eager'
    config.decoder._attn_implementation='eager'
    model=VisionEncoderDecoderModel(config=config).eval()
    expected=model.state_dict();recovered={};unmatched=[]
    for kind in ['encoder','decoder']:
        graph=onnx.load(str(DIRECTORY/(kind+'_model.onnx'))).graph
        tensors={i.name:numpy_helper.to_array(i).copy() for i in graph.initializer}
        for name,value in tensors.items():
            if name.startswith('onnx::'):continue
            key=('encoder.'+name) if kind=='encoder' else name
            if key in expected:
                recovered[key]=torch.from_numpy(value)
            else:unmatched.append(key)
        for node in graph.node:
            if node.op_type!='MatMul' or len(node.input)<2 or node.input[1] not in tensors:continue
            base=node.name.rsplit('/MatMul',1)[0].strip('/').replace('/','.')
            if kind=='encoder':key='encoder.'+base+'.weight'
            else:key=base.replace('decoder.','decoder.model.',1)+'.weight'
            if key not in expected:
                # The final projection belongs to the causal LM, not its decoder wrapper.
                alternative=key.replace('decoder.model.output_projection','decoder.output_projection')
                if alternative in expected:key=alternative
            if key not in expected:
                unmatched.append(key);continue
            value=tensors[node.input[1]].T.copy()
            if tuple(value.shape)!=tuple(expected[key].shape):raise ValueError('Shape mismatch '+key)
            recovered[key]=torch.from_numpy(value)
    missing=sorted(set(expected)-set(recovered))
    allowed={'encoder.pooler.dense.weight','encoder.pooler.dense.bias'}
    unexpected_missing=[name for name in missing if name not in allowed]
    report={'namedParameters':len(expected),'recoveredParameters':len(recovered),
            'missingUnusedPoolingParameters':missing,'unmatchedONNXInitializers':unmatched}
    if unexpected_missing:
        report['missingUsedParameters']=unexpected_missing
        print(json.dumps(report,indent=2),flush=True)
        raise ValueError('Cannot recover every used parameter')
    model.load_state_dict(recovered,strict=False)
    processor=TrOCRProcessor.from_pretrained(DIRECTORY,local_files_only=True,use_fast=False)
    image=Image.open(ROOT/'.cache/pdf-transcription/crops/aa7cce7264ffd20c857ad871.png').convert('RGB')
    pixels=processor(images=[image],return_tensors='pt').pixel_values
    options=ort.SessionOptions();options.intra_op_num_threads=2;options.inter_op_num_threads=1
    encoder=ort.InferenceSession(str(DIRECTORY/'encoder_model.onnx'),sess_options=options,providers=['CPUExecutionProvider'])
    decoder=ort.InferenceSession(str(DIRECTORY/'decoder_model.onnx'),sess_options=options,providers=['CPUExecutionProvider'])
    reference=encoder.run(None,{'pixel_values':pixels.numpy()})[0]
    with torch.inference_mode():actual=model.encoder(pixels).last_hidden_state.numpy()
    report['encoderMaxAbsoluteError']=float(np.max(np.abs(reference-actual)))
    token_ids=np.array([[1,33,56,77,112]],dtype=np.int64)
    expected_logits=decoder.run(None,{'input_ids':token_ids,'encoder_hidden_states':reference})[0]
    with torch.inference_mode():
        actual_logits=model.decoder(input_ids=torch.from_numpy(token_ids),
                                    encoder_hidden_states=torch.from_numpy(reference),use_cache=False).logits.numpy()
    report['decoderMaxAbsoluteError']=float(np.max(np.abs(expected_logits-actual_logits)))
    report['equivalent']=report['encoderMaxAbsoluteError']<.001 and report['decoderMaxAbsoluteError']<.001
    (DIRECTORY/'torch-equivalence.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2),flush=True)
    if not report['equivalent']:raise ValueError('Recovered network differs from original ONNX outputs')
    save_file({k:v.contiguous() for k,v in model.state_dict().items()},str(DIRECTORY/'recovered-model.safetensors'))


if __name__=='__main__':recover()
