#!/usr/bin/env python3
"""Turn the raw sound sources into the small, loudness-matched mp3s the game plays.

    python3 scripts/build-audio.py <dir with mixkit-*.wav> [crowd.wav]

Needs ffmpeg. Output goes to src/client/public/audio/. Loops are only trimmed here: the
browser crossfades them into themselves (see src/client/common/sound.ts), so they never
click or pump at the seam.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / 'src/client/public/audio'

# name -> (source, start s, length s or None, loudness target LUFS, fade in/out s)
BED, SHOT = -24.0, -20.0
CLIPS = {
    # ambient beds (looped by the engine)
    'sea':        ('mixkit-sea-waves-ambience-1189.wav',        30, 40, BED, 0),
    'forest':     ('mixkit-forest-birds-ambience-1210.wav',     40, 40, BED, 0),
    'morning':    ('mixkit-morning-birds-2472.wav',             60, 40, BED, 0),
    'farm':       ('mixkit-farm-animals-in-the-morning-7.wav',   0, 36, BED, 0),
    'pedal':      ('mixkit-bike-pedalling-on-street-loop-1603.wav', 0, 40, BED, 0),
    'rain':       ('mixkit-light-rain-loop-2393.wav',            0, None, BED, 0),
    'storm':      ('mixkit-heavy-rain-drops-2399.wav',           0, None, BED, 0),
    'wheel':      ('mixkit-bike-wheel-spinning-1613.wav',        0, None, BED, 0),
    'crowd':      ('crowd.wav',                                 90, 40, BED, 0),
    # one-shots
    'thunder':    ('mixkit-thunder-rumble-during-a-storm-2395.wav', 0, None, SHOT, 0.05),
    'cheer':      ('mixkit-cheering-crowd-loud-whistle-610.wav', 0, None, SHOT, 0.05),
    'pass-gravel': ('mixkit-bike-passing-by-a-gravel-road-1608.wav', 0, None, SHOT, 0.02),
    'pass-fast':  ('mixkit-fast-bike-passing-by-1606.wav',       0, None, SHOT, 0.02),
    'car':        ('mixkit-fast-car-drive-by-1538.wav',          0, None, SHOT, 0.02),
    'click':      ('mixkit-mechanical-tool-click-1131.wav',      0, None, SHOT, 0.02),
    'shout':      ('mixkit-farm-animals-in-the-morning-7.wav',   4, 5, SHOT, 0.15),
}


def run(args):
    return subprocess.run(args, capture_output=True, text=True, check=True)


def measure(path, ss, t):
    """Integrated loudness of the part we keep."""
    cmd = ['ffmpeg', '-hide_banner', '-ss', str(ss)]
    if t:
        cmd += ['-t', str(t)]
    cmd += ['-i', str(path), '-af', 'loudnorm=print_format=json', '-f', 'null', '-']
    err = subprocess.run(cmd, capture_output=True, text=True).stderr
    block = re.search(r'\{[^{}]*"input_i"[^{}]*\}', err, re.S)
    return float(json.loads(block.group(0))['input_i'])


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    src = Path(sys.argv[1])
    crowd = Path(sys.argv[2]) if len(sys.argv) > 2 else src / 'crowd.wav'
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (file, ss, t, target, fade) in CLIPS.items():
        path = crowd if file == 'crowd.wav' else src / file
        if not path.exists():
            print(f'skip {name}: {path} not found')
            continue
        gain = target - measure(path, ss, t)
        dur = t or float(run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                              '-of', 'csv=p=0', str(path)]).stdout) - ss
        filters = [f'volume={gain:.2f}dB', 'alimiter=limit=0.84:level=false']
        if fade:
            filters += [f'afade=t=in:d={fade}', f'afade=t=out:st={dur - fade:.3f}:d={fade}']
        cmd = ['ffmpeg', '-y', '-v', 'error', '-ss', str(ss)]
        if t:
            cmd += ['-t', str(t)]
        cmd += ['-i', str(path), '-af', ','.join(filters), '-ar', '44100', '-ac', '2',
                '-c:a', 'libmp3lame', '-q:a', '5', str(OUT / f'{name}.mp3')]
        run(cmd)
        print(f'{name:12s} {dur:5.1f}s  gain {gain:+.1f} dB  {(OUT / f"{name}.mp3").stat().st_size // 1024} KB')


main()
