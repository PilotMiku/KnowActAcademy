"""Download the public, MIT-licensed formula model for local inference only."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / '.cache/pdf-transcription'
os.environ['HF_HUB_DISABLE_XET'] = '1'
os.environ['HF_HOME'] = str(CACHE / 'huggingface')
os.environ['TOKENIZERS_PARALLELISM'] = 'false'

from huggingface_hub import snapshot_download

if __name__ == '__main__':
    import argparse
    parser=argparse.ArgumentParser()
    parser.add_argument('--detector',action='store_true')
    args=parser.parse_args()
    name='mfd-1.5' if args.detector else 'mfr-1.5'
    target = CACHE / 'models' / name
    snapshot_download('breezedeus/pix2text-'+name, local_dir=str(target),
                      allow_patterns=['*.json', '*.txt', '*.onnx', '*.model'], max_workers=3)
    print('Local formula model:', target, flush=True)
