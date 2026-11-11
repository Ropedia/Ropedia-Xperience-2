"""HOMIE Gen 2 sensor traces for the website's step-3 cases (runs on h200-sg2, read-only on the data).

For each recording window shown in 3D (frames f0..f1 of the registered take, website/home/data/LH_17761/<take>/mesh.json),
writes sensors_<take>.json with
  imu:   every raw IMU sample in the window (about 200 Hz): its position in frames from f0 (on the frame clock: the
         timestamps of homie_stereo_left_rect_in_kosmos.txt), gyro x y z (rad/s), acc x y z (m/s^2)
  audio: the 4 microphone channels as an RMS envelope, 4 values per frame per channel, normalised per channel
Usage: python3 export_sensors.py OUT_DIR take:f0:f1 [take:f0:f1 ...]
"""
import csv
import json
import os
import sys

import numpy as np

ALIGN = '/mnt/local/lihao/homie_kosmos_alignment_work/batch_lh_all/LH_17761'


def episode(take):
    m = json.load(open(f'{ALIGN}/{take}/metrics.json'))
    return m['homie']['source'].lstrip(':') + 'mocap_main/'


def read_wav(path):   # PCM or IEEE float WAV, any channel count (the stdlib reader refuses float)
    raw = open(path, 'rb').read()
    assert raw[:4] in (b'RIFF', b'RF64') and raw[8:12] == b'WAVE'   # HOMIE writes RF64 (sizes over 4 GB in ds64)
    pos, fmt, data = 12, None, None
    while pos < len(raw) - 8:
        cid, size = raw[pos:pos + 4], int.from_bytes(raw[pos + 4:pos + 8], 'little')
        if size == 0xFFFFFFFF:   # RF64: the real size is in ds64; the data chunk runs to the end of the file
            size = len(raw) - pos - 8
        body = raw[pos + 8:pos + 8 + size]
        if cid == b'fmt ':
            tag, ch, rate = int.from_bytes(body[0:2], 'little'), int.from_bytes(body[2:4], 'little'), int.from_bytes(body[4:8], 'little')
            bits = int.from_bytes(body[14:16], 'little')
            if tag == 0xFFFE:
                tag = int.from_bytes(body[24:26], 'little')
            fmt = (tag, ch, rate, bits)
        elif cid == b'data':
            data = body
        pos += 8 + size + (size & 1)
    tag, ch, rate, bits = fmt
    dt = {(3, 32): np.float32, (3, 64): np.float64, (1, 16): np.int16, (1, 32): np.int32}[(tag, bits)]
    a = np.frombuffer(data[: len(data) // (ch * bits // 8) * ch * bits // 8], dtype=dt).reshape(-1, ch).astype(np.float32)
    if tag == 1:
        a /= float(np.iinfo(dt).max)
    return a, rate


def main():
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    for spec in sys.argv[2:]:
        take, f0, f1 = spec.split(':'); f0, f1 = int(f0), int(f1)
        ep = episode(take)
        ts = np.loadtxt(f'{ALIGN}/{take}/homie_stereo_left_rect_in_kosmos.txt', comments='#')[:, 0]   # s, per frame
        frames = np.arange(len(ts), dtype=np.float64)
        t_a, t_b = ts[f0], ts[f1 - 1]
        # IMU: device clock (ns); the frame stamps are on the same clock (both start within 15 ms of each other)
        rows = []
        with open(ep + 'imu.csv') as fh:
            for r in csv.DictReader(fh):
                t = int(r['device_timestamp_ns']) * 1e-9
                if t_a <= t <= t_b:
                    rows.append([t] + [float(r[k]) for k in ('gyro_x', 'gyro_y', 'gyro_z', 'acc_x', 'acc_y', 'acc_z')])
        imu = np.array(rows)
        fpos = np.interp(imu[:, 0], ts, frames) - f0
        imu_out = np.column_stack([fpos, imu[:, 1:]])
        # audio: 4 channels from record_begin (host clock, which tracks the device clock to a few ms)
        with open(ep + 'audio_timestamps.csv') as fh:
            begin = next(r for r in csv.DictReader(fh) if r['event'] == 'record_begin')
        a, rate = read_wav(ep + 'audio.wav')
        t0_audio = int(begin['host_timestamp_ns']) * 1e-9
        per, env = 4, []
        for k in range((f1 - f0) * per):
            fr = f0 + k / per
            t = np.interp(fr, frames, ts)
            i = int((t - t0_audio) * rate); w = int(rate / 30 / per)
            seg = a[max(0, i - w // 2): max(0, i - w // 2) + w]
            env.append(np.sqrt((seg ** 2).mean(axis=0)) if len(seg) else np.zeros(a.shape[1]))
        env = np.array(env)
        env /= np.maximum(1e-9, np.percentile(env, 99.5, axis=0))
        doc = {'take': take, 'f0': f0, 'f1': f1, 'imu_rate_hz': round(len(imu) / max(1e-6, t_b - t_a), 1),
               'imu': np.round(imu_out, 4).tolist(), 'audio_per_frame': per, 'audio_channels': int(a.shape[1]),
               'audio': np.round(np.clip(env, 0, 1.2), 3).tolist()}
        json.dump(doc, open(f'{out}/sensors_{take}.json', 'w'), separators=(',', ':'))
        g, acc = imu[:, 1:4], imu[:, 4:7]
        print(take, len(imu), 'imu samples', doc['imu_rate_hz'], 'Hz | |gyro| max', round(float(np.linalg.norm(g, axis=1).max()), 2),
              '| |acc| mean', round(float(np.linalg.norm(acc, axis=1).mean()), 2), '| audio', a.shape, rate)


if __name__ == '__main__':
    main()
