## VTT-to-OP47 (OP47 subtitles from WebVTT)

Tool that reads a WebVTT subtitle file and sends OP47 closed captions to CasparCG. 
It is based on [casparcg-vanc-demo](https://github.com/niklaspandersson/casparcg-vanc-demo) repo from [niklaspandersson](https://github.com/niklaspandersson)

- **Start titling:** `POST /titling` with JSON body:
  - `vttPath` (required): path to the VTT file
  - `timeMode` (optional): `"osc"` (default) - time from CasparCG OSC; or `"autonomous"` - local clock
  - `startAt` (optional): when `timeMode` is `"autonomous"`, VTT time in seconds at which to start (default `0`).
- **Stop and clear:** `POST /titling/stop` or `DELETE /titling/stop`

**Example commands** (default API port 8080):

```bash
# Start titling from a VTT file (time from OSC)
curl -X POST http://localhost:8080/titling -H "Content-Type: application/json" -d '{"vttPath":"/path/to/file.vtt"}'

# Start titling in autonomous mode from the beginning
curl -X POST http://localhost:8080/titling -H "Content-Type: application/json" -d '{"vttPath":"/path/to/file.vtt","timeMode":"autonomous"}'

# Start titling in autonomous mode from 90 seconds into the file
curl -X POST http://localhost:8080/titling -H "Content-Type: application/json" -d '{"vttPath":"/path/to/file.vtt","timeMode":"autonomous","startAt":90}'

# Stop titling and clear current title
curl -X POST http://localhost:8080/titling/stop
# or
curl -X DELETE http://localhost:8080/titling/stop
```

Implemented functionality:
- Subtitles are shown/hidden based on play time from OSC or manualy set with the autonomous mod.
- On end of each title, if the next title is in more than 2s, the title is cleared for the pause.
- Text too long to be encoded is split into parts which will be displayed for durations proportional to their character count.

Run: `npm run titling` or `node vtt-titling-server.js`

Env (optional): `HTTP_PORT`, `CASPAR_HOST`, `CASPAR_PORT`, `CASPAR_CHANNEL_LAYER`, `OSC_PORT`, `OSC_TIME_ADDRESS`, `OSC_FILE_ADDRESS`, `OSC_CHANNEL`, `OSC_LAYER`, `MEDIA_ROOT`, `SUBTITLE_ROOT`

`OSC_TIME_ADDRESS` lets you specify the full OSC address to read time from.  
If `OSC_TIME_ADDRESS` is not set, the OSC time source defaults to `/channel/<channel>/stage/layer/<layer>/foreground/file/time`, where `<channel>` and `<layer>` come from `OSC_CHANNEL` / `OSC_LAYER` (or fall back to `1` if unset).

`OSC_FILE_ADDRESS` lets you specify the OSC address that carries the current foreground file path.  
If `OSC_FILE_ADDRESS` is not set, it defaults to `/channel/<channel>/stage/layer/<layer>/foreground/file/path` for the same channel/layer as time.

`MEDIA_ROOT` and `SUBTITLE_ROOT` enable **automatic titling from OSC file paths**:

- The media path from OSC must start with `MEDIA_ROOT`.  
- That prefix is replaced with `SUBTITLE_ROOT`, the rest of the path is kept, and a `subtitles` directory plus `.vtt` extension are added.
- Example:  
  - `MEDIA_ROOT=/mnt/Video`  
  - `SUBTITLE_ROOT=/mnt/s1/video`  
  - Media path from OSC: `/mnt/Video/SeriesXY/S01/SeriesXY_S01E01.MXF`  
  - Auto VTT path: `/mnt/s1/video/SeriesXY/S01/subtitles/SeriesXY_S01E01.vtt`

When a matching `.vtt` file exists at the computed path, the server will:

- Automatically load that VTT and start titling in `timeMode: "osc"` driven by OSC time.
- Switch to a new VTT when the OSC file path changes to another media file with matching subtitles.
- Stop titling (and clear the title) when the OSC file path changes to a media file that has no matching subtitles or no mapping under `MEDIA_ROOT`.

## The casparcg server

1. Using the branch [https://github.com/Bohoaush/caspar_server_fix/tree/vanc-seek-master](https://github.com/Bohoaush/caspar_server_fix/tree/vanc-seek-master)
2. Add the following to your decklink config in casparcg.config

```xml
<vanc>
    <op47-line>12</op47-line>
    <op47-line-field2>575</op47-line-field2>
    <op42-sd-line>21</op42-sd-line>
    <op47-dummy-header>VVUnFRXq6v0v6pteFSAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg</op47-dummy-header>
    <scte104-line>13</scte104-line>
</vanc>
```

# Standards (teletext / subtitles)

- **OP-47** (VANC teletext) follows **ETS 300 706** (Enhanced Teletext) and **ITU-R BT.653** (System B). Packet X/26 enhancement data and row encoding are per ETS 300 706.

# Demo on VANC in caspar

This repo contains everything you need to send OP47 and SCTE104 vanc payload to a casparcg server

Refer to the `op47-client.js` and `sce104-client.js` for how to format AMCP commands to push vanc data to the server

## OP47
Run `node op47-client.js`

## SCTE104
Run `node scte104-client.js`
