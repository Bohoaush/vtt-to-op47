## VTT-to-OP47 (OP47 subtitles from WebVTT)

Nástroj čte titulkový soubor WebVTT a posílá OP47 pakety se skrytými titulky do CasparCG serveru.
Založeno na [casparcg-vanc-demo](https://github.com/niklaspandersson/casparcg-vanc-demo) repo od [niklaspandersson](https://github.com/niklaspandersson)

- **Začít titulkovat:** `POST /titling` s JSON obsahem:
  - `vttPath` (vyžadováno): cesta k VTT souboru
  - `timeMode` (volitelné): `"osc"` (výchozí) - čas z CasparCG OSC; nebo `"autonomous"` - vlastní čas
  - `startAt` (volitelné): pokud je `timeMode` nastaven na `"autonomous"`, je toto čas ve kterém se má začít ve VTT souboru v sekundách (výchozí = `0`).
- **Přestat a vyčistit výstup:** `POST /titling/stop` or `DELETE /titling/stop`

**Příklady použití API s curl** (výchozí port API 8080):

```bash
# Začít titulkovat z VTT souboru (čas z OSC)
curl -X POST http://localhost:8080/titling -H "Content-Type: application/json" -d '{"vttPath":"/path/to/file.vtt"}'

# Začít titulkovat s autonomním časem od začátku
curl -X POST http://localhost:8080/titling -H "Content-Type: application/json" -d '{"vttPath":"/path/to/file.vtt","timeMode":"autonomous"}'

# Začít titulkovat s autonomním časem od 90. sekundy v souboru
curl -X POST http://localhost:8080/titling -H "Content-Type: application/json" -d '{"vttPath":"/path/to/file.vtt","timeMode":"autonomous","startAt":90}'

# Přestat titulkovat a vyčistit výstup
curl -X POST http://localhost:8080/titling/stop
# nebo
curl -X DELETE http://localhost:8080/titling/stop
```

Implementované funkce:
- Titulky jsou zobrazeny/skryty podle času v souboru podle OSC, nebo manuálně nastaveného v autonomním režimu.
- Pokud je následující titulek za více než 2s, titulky jsou skryté po dobu této mezery.
- Text který je příliš dlouhý aby byl zpracován je rozdělen na části které budou zobrazeny na dobu poměrnou k počtu znaků.

Spuštění: `npm run titling` nebo `node vtt-titling-server.js`

Env (volitelné): `HTTP_PORT`, `CASPAR_HOST`, `CASPAR_PORT`, `CASPAR_CHANNEL_LAYER`, `OSC_PORT`, `OSC_TIME_ADDRESS`, `OSC_FILE_ADDRESS`, `OSC_CHANNEL`, `OSC_LAYER`, `MEDIA_ROOT`, `SUBTITLE_ROOT`

`OSC_TIME_ADDRESS` umožňuje specifikovat úplnou OSC adresu ze které se má číst čas.
Pokud není nastaveno `OSC_TIME_ADDRESS`, časová OSC adresa bude `/channel/<channel>/stage/layer/<layer>/foreground/file/time`, kde `<channel>` and `<layer>` je `OSC_CHANNEL` / `OSC_LAYER` (nebo `1` pokud nejsou proměnné nastaveny). Channel a layer odpovídá kanálu a vrstvě ve které se přehrávají videosoubory ke kterým jsou titulkové soubory určeny

`OSC_FILE_ADDRESS` je úplná OSC adresa s úplnou cestou k aktuálně přehrávanému souboru.
Pokud není nastaveno `OSC_FILE_ADDRESS` OSC adresa k souborové cestě bude `/channel/<channel>/stage/layer/<layer>/foreground/file/path` pro stejný kanál a vrstvu jako čas.

`MEDIA_ROOT` a `SUBTITLE_ROOT` umožní **automatické titulkování podle souborové cesty z OSC**:

- Cesta k videosouboru musí začínat s `MEDIA_ROOT`.
- Ta je nahrazena `SUBTITLE_ROOT`, zbytek cesty zůstává, a je přidaná složka `subtitles`. Přípona souboru je vyměněná za `.vtt`.
- Příklad:  
  - `MEDIA_ROOT=/mnt/Video`  
  - `SUBTITLE_ROOT=/mnt/s1/video`
  - Cesta k videu z OSC: `/mnt/Video/SeriesXY/S01/SeriesXY_S01E01.MXF`
  - Předpokládaná cesta k VTT: `/mnt/s1/video/SeriesXY/S01/subtitles/SeriesXY_S01E01.vtt`

Pokud je nalezen VTT soubor, dojde k:

- Načtení VTT souboru a spuštění titulkování v režimu OSC.
- Přepnutí na jiný VTT soubor, jakmile se cesta z OSC změní, pokud je k aktuálnímu souboru k dispozici soubor s titulky.
- Přerušení titulkování a vyčištění posledního titulku pokud se cesta z OSC změní na soubor ke kterému není k dispozici soubor s titulky.

## CasparCG server

1. Počítá se s použitím větve [https://github.com/Bohoaush/caspar_server_fix/tree/vanc-seek-master](https://github.com/Bohoaush/caspar_server_fix/tree/vanc-seek-master)
2. Je třeba nakonfigurovat v nastavení pro DeckLink v casparcg.config, např:

```xml
<vanc>
    <op47-line>12</op47-line>
    <op47-line-field2>575</op47-line-field2>
    <op42-sd-line>21</op42-sd-line>
    <op47-dummy-header>VVUnFRXq6v0v6pteFSAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg</op47-dummy-header>
    <scte104-line>13</scte104-line>
</vanc>
```