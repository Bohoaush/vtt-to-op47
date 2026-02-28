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
- On end of each title, if the next title is more than 2s, the title is cleared for the pause.
- Text too long to be encoded is split into parts which will be displayed for durations proportional to their character count.

Run: `npm run titling` or `node vtt-titling-server.js`

Env (optional): `HTTP_PORT`, `CASPAR_HOST`, `CASPAR_PORT`, `CASPAR_CHANNEL_LAYER`, `OSC_PORT`, `OSC_TIME_ADDRESS`

## The casparcg server

1. Using the branch `https://github.com/nxtedition/casparcg/tree/wintv-vanc`
2. Add the following to your decklink config in casparcg.config

```xml
<vanc>
    <op47-line>12</op47-line>
    <op47-line-field2>575</op47-line-field2>
    <op47-dummy-header>VVUnFRXq6v0v6pteFSAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg</op47-dummy-header>
    <scte104-line>13</scte104-line>
</vanc>
```

# Demo on VANC in caspar

This repo contains everything you need to send OP47 and SCTE104 vanc payload to a casparcg server

Refer to the `op47-client.js` and `sce104-client.js` for how to format AMCP commands to push vanc data to the server

## OP47
Run `node op47-client.js`

## SCTE104
Run `node scte104-client.js`
