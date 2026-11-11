// Footer play area: the relate arch on a graph floor, with smooth stickers that fall, collide and
// can be thrown. Ported from the Relate home design; reads the site's colour tokens at draw time.
(function () {
  if (!document.getElementById('play') || !document.getElementById('pc')) return;
  const $ = (s, r = document) => r.querySelector(s);
  const RM = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TONE_PATHS = {
    hl: 'M3 0h6v1h-6zM2 1h1v1h-1zM1 2h1v1h-1zM1 3h1v1h-1zM7 3h1v1h-1zM1 4h1v1h-1zM8 4h1v1h-1zM1 5h1v1h-1zM8 5h1v1h-1zM1 6h1v1h-1zM8 6h1v1h-1zM0 7h1v1h-1zM8 7h1v1h-1zM0 8h1v1h-1zM8 8h1v1h-1zM0 9h1v1h-1zM8 9h1v1h-1z',
    md: 'M3 1h6v1h-6zM2 2h3v1h-3zM7 2h3v1h-3zM2 3h2v1h-2zM8 3h2v1h-2zM2 4h1v1h-1zM9 4h1v1h-1zM2 5h1v1h-1zM9 5h1v1h-1zM2 6h1v1h-1zM9 6h1v1h-1zM1 7h2v1h-2zM9 7h2v1h-2zM1 8h2v1h-2zM9 8h2v1h-2z',
    sh: 'M9 1h1v1h-1zM5 2h2v1h-2zM10 2h1v1h-1zM4 3h1v1h-1zM10 3h1v1h-1zM3 4h1v1h-1zM10 4h1v1h-1zM3 5h1v1h-1zM10 5h1v1h-1zM3 6h1v1h-1zM10 6h1v1h-1zM3 7h1v1h-1zM11 7h1v1h-1zM3 8h1v1h-1zM11 8h1v1h-1zM1 9h3v1h-3zM9 9h3v1h-3z'
  };
  /* the arch's footprint, used only for collisions (it is drawn as a smooth outline) */
  const CELLS = []; Object.keys(TONE_PATHS).forEach((t) => { const re = /M(\d+) (\d+)h(\d+)v1/g; let m; while ((m = re.exec(TONE_PATHS[t]))) for (let x = +m[1]; x < +m[1] + +m[3]; x++) CELLS.push({ x, y: +m[2], t }); });
  /* footer play area: the arch, with smooth stickers that fall, collide and can be thrown */
  (function play() {
    const box = $('#play'), cv = $('#pc'), ctx = cv.getContext('2d');
    const BI = {"database": "<rect x=\"5\" y=\"5\" width=\"22\" height=\"22\" rx=\"5\" fill=\"#0A6190\" /><path d=\"M5 11v-1a5 5 0 0 1 5-5h12a5 5 0 0 1 5 5v1z\" fill=\"#8FE3E8\" /><path transform=\"translate(11 14) scale(1)\" fill=\"#F0E9D6\" d=\"M0 9V5a5 5 0 0 1 10 0v4H7V5a2 2 0 0 0-4 0v4z\"/>", "chip": "<rect x=\"9\" y=\"3\" width=\"2.5\" height=\"5\" rx=\"1.2\" fill=\"#F6C244\" /><rect x=\"9\" y=\"24\" width=\"2.5\" height=\"5\" rx=\"1.2\" fill=\"#F6C244\" /><rect x=\"3\" y=\"9\" width=\"5\" height=\"2.5\" rx=\"1.2\" fill=\"#F6C244\" /><rect x=\"24\" y=\"9\" width=\"5\" height=\"2.5\" rx=\"1.2\" fill=\"#F6C244\" /><rect x=\"14.75\" y=\"3\" width=\"2.5\" height=\"5\" rx=\"1.2\" fill=\"#F6C244\" /><rect x=\"14.75\" y=\"24\" width=\"2.5\" height=\"5\" rx=\"1.2\" fill=\"#F6C244\" /><rect x=\"3\" y=\"14.75\" width=\"5\" height=\"2.5\" rx=\"1.2\" fill=\"#F6C244\" /><rect x=\"24\" y=\"14.75\" width=\"5\" height=\"2.5\" rx=\"1.2\" fill=\"#F6C244\" /><rect x=\"20.5\" y=\"3\" width=\"2.5\" height=\"5\" rx=\"1.2\" fill=\"#F6C244\" /><rect x=\"20.5\" y=\"24\" width=\"2.5\" height=\"5\" rx=\"1.2\" fill=\"#F6C244\" /><rect x=\"3\" y=\"20.5\" width=\"5\" height=\"2.5\" rx=\"1.2\" fill=\"#F6C244\" /><rect x=\"24\" y=\"20.5\" width=\"5\" height=\"2.5\" rx=\"1.2\" fill=\"#F6C244\" /><rect x=\"7\" y=\"7\" width=\"18\" height=\"18\" rx=\"4\" fill=\"#0A6190\" /><path transform=\"translate(11 12.5) scale(1)\" fill=\"#F0E9D6\" d=\"M0 9V5a5 5 0 0 1 10 0v4H7V5a2 2 0 0 0-4 0v4z\"/>", "search": "<circle cx=\"13\" cy=\"13\" r=\"9\" fill=\"#F0E9D6\"/><circle cx=\"13\" cy=\"13\" r=\"6.2\" fill=\"#8FE3E8\"/><path d=\"M20 20l7 7\" fill=\"none\" stroke=\"#F96746\" stroke-width=\"4.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path transform=\"translate(8.5 10) scale(0.95)\" fill=\"#0A6190\" d=\"M0 9V5a5 5 0 0 1 10 0v4H7V5a2 2 0 0 0-4 0v4z\"/>", "lock": "<path d=\"M10.5 15V10.5a5.5 5.5 0 0 1 11 0V15\" fill=\"none\" stroke=\"#CDD3D8\" stroke-width=\"3.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><rect x=\"5\" y=\"14\" width=\"22\" height=\"15\" rx=\"4\" fill=\"#F6C244\" /><circle cx=\"16\" cy=\"20.5\" r=\"2.6\" fill=\"#002B43\"/><rect x=\"15\" y=\"21\" width=\"2\" height=\"4.5\" rx=\"1\" fill=\"#002B43\" />", "cloud": "<path d=\"M9 26a6.5 6.5 0 0 1-.6-13A8.5 8.5 0 0 1 24.5 14 6 6 0 0 1 23.5 26z\" fill=\"#FFFFFF\" /><path transform=\"translate(11 16.5) scale(1)\" fill=\"#0A6190\" d=\"M0 9V5a5 5 0 0 1 10 0v4H7V5a2 2 0 0 0-4 0v4z\"/><rect x=\"8\" y=\"24.5\" width=\"16\" height=\"1.5\" rx=\"0.7\" fill=\"#8FE3E8\" />", "terminal": "<rect x=\"3\" y=\"6\" width=\"26\" height=\"20\" rx=\"4\" fill=\"#002B43\" /><path d=\"M3 10a4 4 0 0 1 4-4h18a4 4 0 0 1 4 4v1H3z\" fill=\"#8FE3E8\" /><circle cx=\"7\" cy=\"8.6\" r=\"1\" fill=\"#F96746\"/><circle cx=\"10\" cy=\"8.6\" r=\"1\" fill=\"#F6C244\"/><circle cx=\"13\" cy=\"8.6\" r=\"1\" fill=\"#8FCB62\"/><path d=\"M7 15l3.5 2.8L7 20.6\" fill=\"none\" stroke=\"#F0E9D6\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path transform=\"translate(17 15.5) scale(1)\" fill=\"#F0E9D6\" d=\"M0 9V5a5 5 0 0 1 10 0v4H7V5a2 2 0 0 0-4 0v4z\"/>", "book": "<rect x=\"6\" y=\"3.5\" width=\"20\" height=\"25\" rx=\"3.5\" fill=\"#0A6190\" /><rect x=\"6\" y=\"3.5\" width=\"4.5\" height=\"25\" rx=\"2.5\" fill=\"#002B43\" /><rect x=\"23.5\" y=\"5.5\" width=\"2.5\" height=\"21\" rx=\"1\" fill=\"#F0E9D6\" /><rect x=\"13\" y=\"20\" width=\"9\" height=\"1.8\" rx=\"0.9\" fill=\"#4C99A4\" /><rect x=\"13\" y=\"23.5\" width=\"6\" height=\"1.8\" rx=\"0.9\" fill=\"#4C99A4\" />", "graph": "<path d=\"M12 12L9 8M20 12l4-4M16 20v4\" fill=\"none\" stroke=\"#4C99A4\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><circle cx=\"8\" cy=\"7\" r=\"4.5\" fill=\"#F6C244\"/><circle cx=\"24\" cy=\"7\" r=\"4.5\" fill=\"#F96746\"/><circle cx=\"16\" cy=\"16\" r=\"6.5\" fill=\"#8FE3E8\"/><circle cx=\"16\" cy=\"26\" r=\"4.2\" fill=\"#8FCB62\"/><path transform=\"translate(11.7 12.8) scale(0.85)\" fill=\"#0A6190\" d=\"M0 9V5a5 5 0 0 1 10 0v4H7V5a2 2 0 0 0-4 0v4z\"/>", "package": "<rect x=\"4\" y=\"8\" width=\"24\" height=\"20\" rx=\"3\" fill=\"#F96746\" /><path d=\"M4 11a3 3 0 0 1 3-3h18a3 3 0 0 1 3 3v3H4z\" fill=\"#FF8E6A\" /><path transform=\"translate(11 15.5) scale(1)\" fill=\"#F0E9D6\" d=\"M0 9V5a5 5 0 0 1 10 0v4H7V5a2 2 0 0 0-4 0v4z\"/>", "key": "<circle cx=\"10\" cy=\"16\" r=\"7.5\" fill=\"#F6C244\"/><circle cx=\"10\" cy=\"16\" r=\"3\" fill=\"#002B43\"/><path d=\"M16 14h11a2 2 0 0 1 2 2v1.5a2 2 0 0 1-2 2h-1v3.5h-3.5v-3.5H16z\" fill=\"#B9B94A\" />", "shield": "<path d=\"M16 3l11 4v8c0 7-5 11-11 14C10 26 5 22 5 15V7z\" fill=\"#0A6190\" /><path d=\"M16 3l11 4v3.5H5V7z\" fill=\"#8FE3E8\" /><path transform=\"translate(11 13) scale(1)\" fill=\"#F0E9D6\" d=\"M0 9V5a5 5 0 0 1 10 0v4H7V5a2 2 0 0 0-4 0v4z\"/>", "folder": "<path d=\"M3 9a3 3 0 0 1 3-3h6l3 3h11a3 3 0 0 1 3 3v13a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z\" fill=\"#F6C244\" /><path d=\"M3 9a3 3 0 0 1 3-3h6l3 3z\" fill=\"#D9A82E\" /><path transform=\"translate(11 14.5) scale(1)\" fill=\"#002B43\" d=\"M0 9V5a5 5 0 0 1 10 0v4H7V5a2 2 0 0 0-4 0v4z\"/>", "bell": "<path d=\"M16 4c-4.5 0-7.5 3.5-7.5 8v5l-3 5h21l-3-5v-5c0-4.5-3-8-7.5-8z\" fill=\"#F6C244\" /><circle cx=\"16\" cy=\"27\" r=\"2.5\" fill=\"#F96746\"/>", "gear": "<rect x=\"13\" y=\"2\" width=\"6\" height=\"28\" rx=\"2\" fill=\"#CDD3D8\" transform=\"rotate(0 16 16)\"/><rect x=\"13\" y=\"2\" width=\"6\" height=\"28\" rx=\"2\" fill=\"#CDD3D8\" transform=\"rotate(45 16 16)\"/><rect x=\"13\" y=\"2\" width=\"6\" height=\"28\" rx=\"2\" fill=\"#CDD3D8\" transform=\"rotate(90 16 16)\"/><rect x=\"13\" y=\"2\" width=\"6\" height=\"28\" rx=\"2\" fill=\"#CDD3D8\" transform=\"rotate(135 16 16)\"/><circle cx=\"16\" cy=\"16\" r=\"10\" fill=\"#CDD3D8\"/><circle cx=\"16\" cy=\"16\" r=\"6.5\" fill=\"#002B43\"/>", "plug": "<rect x=\"9\" y=\"3\" width=\"3.5\" height=\"8\" rx=\"1.5\" fill=\"#CDD3D8\" /><rect x=\"19.5\" y=\"3\" width=\"3.5\" height=\"8\" rx=\"1.5\" fill=\"#CDD3D8\" /><rect x=\"6\" y=\"9\" width=\"20\" height=\"13\" rx=\"4\" fill=\"#0A6190\" /><rect x=\"14\" y=\"21\" width=\"4\" height=\"8\" rx=\"1.5\" fill=\"#6B7780\" />", "cube": "<path d=\"M16 3L27 8.5 16 14 5 8.5z\" fill=\"#8FE3E8\" /><path d=\"M5 8.5L16 14v15L5 23.5z\" fill=\"#4C99A4\" /><path d=\"M27 8.5L16 14v15l11-5.5z\" fill=\"#0A6190\" />", "floppy": "<rect x=\"4\" y=\"4\" width=\"24\" height=\"24\" rx=\"3.5\" fill=\"#0A6190\" /><rect x=\"9\" y=\"4\" width=\"14\" height=\"10\" rx=\"1.5\" fill=\"#F0E9D6\" /><rect x=\"9\" y=\"19\" width=\"14\" height=\"9\" rx=\"1.5\" fill=\"#CDD3D8\" /><rect x=\"18\" y=\"21\" width=\"2.5\" height=\"5\" rx=\"1\" fill=\"#002B43\" />", "bookmark": "<path d=\"M8 3h16a2 2 0 0 1 2 2v24l-10-6-10 6V5a2 2 0 0 1 2-2z\" fill=\"#6A82FF\" />", "tag": "<path d=\"M4 10a4 4 0 0 1 4-4h11l9 10-9 10H8a4 4 0 0 1-4-4z\" fill=\"#8FCB62\" /><circle cx=\"8.5\" cy=\"16\" r=\"1.6\" fill=\"#145439\"/>", "window": "<rect x=\"3\" y=\"5\" width=\"26\" height=\"22\" rx=\"3.5\" fill=\"#F0E9D6\" /><path d=\"M3 8.5A3.5 3.5 0 0 1 6.5 5h19A3.5 3.5 0 0 1 29 8.5V11H3z\" fill=\"#0A6190\" /><circle cx=\"7\" cy=\"8\" r=\"1\" fill=\"#F96746\"/><circle cx=\"10\" cy=\"8\" r=\"1\" fill=\"#F6C244\"/><circle cx=\"13\" cy=\"8\" r=\"1\" fill=\"#8FCB62\"/><path transform=\"translate(7 16) scale(1.3)\" fill=\"#0A6190\" d=\"M0 9V5a5 5 0 0 1 10 0v4H7V5a2 2 0 0 0-4 0v4z\"/><rect x=\"21\" y=\"16\" width=\"5\" height=\"1.8\" rx=\"0.9\" fill=\"#CDD3D8\" /><rect x=\"21\" y=\"20\" width=\"5\" height=\"1.8\" rx=\"0.9\" fill=\"#CDD3D8\" />", "chat": "<path d=\"M7 5h18a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H15l-6 5v-5H7a4 4 0 0 1-4-4V9a4 4 0 0 1 4-4z\" fill=\"#8FE3E8\" /><path transform=\"translate(11 9.5) scale(1)\" fill=\"#002B43\" d=\"M0 9V5a5 5 0 0 1 10 0v4H7V5a2 2 0 0 0-4 0v4z\"/>", "link": "<path d=\"M10 10l12 12\" fill=\"none\" stroke=\"#F0E9D6\" stroke-width=\"3\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><circle cx=\"9\" cy=\"9\" r=\"6\" fill=\"#F6C244\"/><circle cx=\"23\" cy=\"23\" r=\"6\" fill=\"#F96746\"/>", "node": "<circle cx=\"16\" cy=\"16\" r=\"12.5\" fill=\"#F6C244\"/><circle cx=\"16\" cy=\"16\" r=\"12.5\" fill=\"none\"/><path transform=\"translate(10.5 11.5) scale(1.1)\" fill=\"#002B43\" d=\"M0 9V5a5 5 0 0 1 10 0v4H7V5a2 2 0 0 0-4 0v4z\"/>", "wand": "<path d=\"M7 25l13-13\" fill=\"none\" stroke=\"#F0E9D6\" stroke-width=\"4.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M9 23l3-3\" fill=\"none\" stroke=\"#0A6190\" stroke-width=\"4.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M22.5 3l2 4.5 4.5 2-4.5 2-2 4.5-2-4.5-4.5-2 4.5-2z\" fill=\"#F6C244\" />", "inbox": "<rect x=\"9\" y=\"4\" width=\"14\" height=\"10\" rx=\"1.5\" fill=\"#F0E9D6\" /><path d=\"M4 16a3 3 0 0 1 3-3h18a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z\" fill=\"#6A82FF\" /><rect x=\"4\" y=\"16\" width=\"24\" height=\"2.5\" rx=\"0\" fill=\"#9AA8FF\" />", "code": "<rect x=\"3\" y=\"6\" width=\"26\" height=\"20\" rx=\"4\" fill=\"#002B43\" /><path d=\"M12 12l-4.5 4 4.5 4M20 12l4.5 4-4.5 4\" fill=\"none\" stroke=\"#8FE3E8\" stroke-width=\"2.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M17.5 11l-3 10\" fill=\"none\" stroke=\"#F0E9D6\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "branch": "<path d=\"M10 8v16M10 14c0 5 12 0 12-6\" fill=\"none\" stroke=\"#4C99A4\" stroke-width=\"2.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><circle cx=\"10\" cy=\"7\" r=\"3.6\" fill=\"#8FCB62\"/><circle cx=\"10\" cy=\"25\" r=\"3.6\" fill=\"#8FCB62\"/><circle cx=\"22\" cy=\"8\" r=\"3.6\" fill=\"#F96746\"/>", "server": "<rect x=\"4\" y=\"5\" width=\"24\" height=\"9\" rx=\"3\" fill=\"#0A6190\" /><rect x=\"4\" y=\"17\" width=\"24\" height=\"9\" rx=\"3\" fill=\"#0A6190\" /><circle cx=\"9\" cy=\"9.5\" r=\"1.5\" fill=\"#8FCB62\"/><circle cx=\"9\" cy=\"21.5\" r=\"1.5\" fill=\"#F6C244\"/><rect x=\"15\" y=\"8.5\" width=\"9\" height=\"2\" rx=\"1\" fill=\"#8FE3E8\" /><rect x=\"15\" y=\"20.5\" width=\"9\" height=\"2\" rx=\"1\" fill=\"#8FE3E8\" /><rect x=\"12\" y=\"14\" width=\"2\" height=\"3\" rx=\"0\" fill=\"#CDD3D8\" /><rect x=\"18\" y=\"14\" width=\"2\" height=\"3\" rx=\"0\" fill=\"#CDD3D8\" />", "bot": "<rect x=\"5\" y=\"9\" width=\"22\" height=\"17\" rx=\"6\" fill=\"#8FE3E8\" /><rect x=\"14.8\" y=\"4\" width=\"2.4\" height=\"5\" rx=\"1.2\" fill=\"#CDD3D8\" /><circle cx=\"16\" cy=\"4\" r=\"2\" fill=\"#F96746\"/><circle cx=\"11.5\" cy=\"17\" r=\"2.6\" fill=\"#002B43\"/><circle cx=\"20.5\" cy=\"17\" r=\"2.6\" fill=\"#002B43\"/><rect x=\"12\" y=\"21.5\" width=\"8\" height=\"1.8\" rx=\"0.9\" fill=\"#002B43\" /><rect x=\"2\" y=\"14\" width=\"3\" height=\"7\" rx=\"1.5\" fill=\"#0A6190\" /><rect x=\"27\" y=\"14\" width=\"3\" height=\"7\" rx=\"1.5\" fill=\"#0A6190\" />", "brain": "<path d=\"M13 4a5 5 0 0 0-5 4 5 5 0 0 0-3 8 5 5 0 0 0 3 8 5 5 0 0 0 8 2V6a4 4 0 0 0-3-2z\" fill=\"#6A82FF\" /><path d=\"M19 4a5 5 0 0 1 5 4 5 5 0 0 1 3 8 5 5 0 0 1-3 8 5 5 0 0 1-8 2V6a4 4 0 0 1 3-2z\" fill=\"#8EA0FF\" /><path d=\"M16 8v18M11 12h3M18 16h3M11 20h3\" fill=\"none\" stroke=\"#002B43\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "laptop": "<rect x=\"6\" y=\"6\" width=\"20\" height=\"15\" rx=\"3\" fill=\"#002B43\" /><rect x=\"8.5\" y=\"8.5\" width=\"15\" height=\"10\" rx=\"1.5\" fill=\"#8FE3E8\" /><path d=\"M2 23h28v1.5a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3z\" fill=\"#CDD3D8\" /><path transform=\"translate(11 10.5) scale(1)\" fill=\"#0A6190\" d=\"M0 9V5a5 5 0 0 1 10 0v4H7V5a2 2 0 0 0-4 0v4z\"/>", "bug": "<path d=\"M16 8c-4 0-7 3-7 7v4c0 4 3 7 7 7s7-3 7-7v-4c0-4-3-7-7-7z\" fill=\"#8FCB62\" /><path d=\"M12 8a4 4 0 0 1 8 0z\" fill=\"#145439\" /><path d=\"M3 12l5 3M29 12l-5 3M2 20h6M30 20h-6M4 28l5-4M28 28l-5-4M16 12v15\" fill=\"none\" stroke=\"#145439\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "json": "<rect x=\"3\" y=\"5\" width=\"26\" height=\"22\" rx=\"4\" fill=\"#F0E9D6\" /><path d=\"M12 9c-2.5 0-3 1-3 3v2c0 1.5-1 2-2 2 1 0 2 .5 2 2v2c0 2 .5 3 3 3\" fill=\"none\" stroke=\"#0A6190\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M20 9c2.5 0 3 1 3 3v2c0 1.5 1 2 2 2-1 0-2 .5-2 2v2c0 2-.5 3-3 3\" fill=\"none\" stroke=\"#0A6190\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><circle cx=\"16\" cy=\"16\" r=\"1.6\" fill=\"#F96746\"/>", "table": "<rect x=\"3\" y=\"5\" width=\"26\" height=\"22\" rx=\"3.5\" fill=\"#F0E9D6\" /><path d=\"M3 8.5A3.5 3.5 0 0 1 6.5 5h19A3.5 3.5 0 0 1 29 8.5V12H3z\" fill=\"#8FCB62\" /><path d=\"M3 18.5h26M3 24h26M11.5 12v15M20 12v15\" fill=\"none\" stroke=\"#CDD3D8\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "chart": "<rect x=\"4\" y=\"4\" width=\"24\" height=\"24\" rx=\"4\" fill=\"#F0E9D6\" /><rect x=\"8\" y=\"16\" width=\"4.5\" height=\"8\" rx=\"1.2\" fill=\"#4C99A4\" /><rect x=\"14\" y=\"11\" width=\"4.5\" height=\"13\" rx=\"1.2\" fill=\"#F96746\" /><rect x=\"20\" y=\"7.5\" width=\"4.5\" height=\"16.5\" rx=\"1.2\" fill=\"#0A6190\" />", "rocket": "<path d=\"M16 3c5 3 7 8 7 13l-2.5 4h-9L9 16c0-5 2-10 7-13z\" fill=\"#F0E9D6\" /><circle cx=\"16\" cy=\"13\" r=\"3\" fill=\"#8FE3E8\"/><path d=\"M9 16l-4 6 5-1.5zM23 16l4 6-5-1.5z\" fill=\"#F96746\" /><path d=\"M13 22h6l-3 7z\" fill=\"#F6C244\" />", "layers": "<path d=\"M16 4l13 7-13 7-13-7z\" fill=\"#8FE3E8\" /><path d=\"M3 16l13 7 13-7\" fill=\"none\" stroke=\"#4C99A4\" stroke-width=\"3\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M3 21.5l13 7 13-7\" fill=\"none\" stroke=\"#0A6190\" stroke-width=\"3\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "sparkle": "<path d=\"M14 3l3 8 8 3-8 3-3 8-3-8-8-3 8-3z\" fill=\"#F6C244\" /><path d=\"M25 3l1.2 3.3L29.5 7.5l-3.3 1.2L25 12l-1.2-3.3L20.5 7.5l3.3-1.2z\" fill=\"#8FE3E8\" />", "api": "<circle cx=\"8\" cy=\"16\" r=\"5\" fill=\"#F96746\"/><circle cx=\"24\" cy=\"8\" r=\"4\" fill=\"#8FE3E8\"/><circle cx=\"24\" cy=\"24\" r=\"4\" fill=\"#8FCB62\"/><path d=\"M12.5 14l8-4.5M12.5 18l8 4.5\" fill=\"none\" stroke=\"#CDD3D8\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "cpu2": "<rect x=\"7\" y=\"7\" width=\"18\" height=\"18\" rx=\"4\" fill=\"#002B43\" /><path transform=\"translate(11 12.5) scale(1)\" fill=\"#8FE3E8\" d=\"M0 9V5a5 5 0 0 1 10 0v4H7V5a2 2 0 0 0-4 0v4z\"/><rect x=\"11\" y=\"3\" width=\"2\" height=\"4\" rx=\"1\" fill=\"#CDD3D8\" /><rect x=\"11\" y=\"25\" width=\"2\" height=\"4\" rx=\"1\" fill=\"#CDD3D8\" /><rect x=\"15\" y=\"3\" width=\"2\" height=\"4\" rx=\"1\" fill=\"#CDD3D8\" /><rect x=\"15\" y=\"25\" width=\"2\" height=\"4\" rx=\"1\" fill=\"#CDD3D8\" /><rect x=\"19\" y=\"3\" width=\"2\" height=\"4\" rx=\"1\" fill=\"#CDD3D8\" /><rect x=\"19\" y=\"25\" width=\"2\" height=\"4\" rx=\"1\" fill=\"#CDD3D8\" />"};
    const KINDS = ['archie'].concat(Object.keys(BI));
    const MASCOT = "\n<path d=\"M298.776 0C448.554 0 569.992 121.697 569.992 271.795V439.502C569.992 449.166 562.158 457 552.494 457H392.011C382.347 457 374.513 449.166 374.513 439.502V271.795C374.513 229.952 340.53 195.896 298.776 195.896V0Z\" fill=\"#145439\"/>\n<path d=\"M298.776 0C148.997 0 27.5591 121.697 27.5591 271.795L27.5591 439.502C27.5591 449.166 35.3931 457 45.0569 457H205.541C215.204 457 223.039 449.166 223.039 439.502V271.795C223.039 229.952 257.022 195.896 298.776 195.896V0Z\" fill=\"#0A6190\"/>\n<path d=\"M271.217 0C420.995 0 542.433 121.697 542.433 271.795V439.502C542.433 449.166 534.599 457 524.935 457H364.451C354.788 457 346.954 449.166 346.954 439.502V271.795C346.954 229.952 312.971 195.896 271.217 195.896V0Z\" fill=\"#8FCB62\"/>\n<path d=\"M271.217 0C121.438 0 0 121.697 0 271.795V439.502C0 449.166 7.83405 457 17.4978 457H177.982C187.645 457 195.479 449.166 195.479 439.502V271.795C195.479 229.952 229.462 195.896 271.217 195.896V0Z\" fill=\"#8FE3E8\"/>\n<path d=\"M360.013 73.3696C359.805 73.3696 359.607 73.3477 359.398 73.3477C349.144 73.3477 340.843 86.2154 340.843 102.092C340.843 117.968 349.144 130.824 359.398 130.824C359.607 130.824 359.805 130.814 360.013 130.803C369.971 130.297 377.953 117.638 377.953 102.092C377.953 86.5448 369.971 73.8747 360.013 73.3696Z\" fill=\"#145439\"/>\n<path d=\"M201.186 102.092C201.186 117.957 192.875 130.824 182.631 130.824C172.388 130.824 164.076 117.957 164.076 102.092C164.076 86.2264 172.377 73.3477 182.631 73.3477C192.886 73.3477 201.186 86.2154 201.186 102.092Z\" fill=\"#0A6190\"/>\n<path d=\"M233.244 108.748C234.781 116.12 238.435 122.951 243.841 128.357C251.021 135.537 261.263 138.532 271.401 138.675V123.758C265.312 123.758 259.471 121.338 255.165 117.032C252.77 114.637 250.958 111.766 249.822 108.642C248.311 104.486 244.855 100.796 240.432 100.796C236.01 100.796 232.342 104.418 233.244 108.748Z\" fill=\"#0A6190\"/>\n<path d=\"M309.009 108.748C307.473 116.12 303.819 122.951 298.413 128.357C291.233 135.537 280.991 138.532 270.852 138.675V123.758C276.942 123.758 282.782 121.338 287.088 117.032C289.484 114.637 291.295 111.766 292.431 108.642C293.943 104.486 297.399 100.796 301.821 100.796C306.244 100.796 309.911 104.418 309.009 108.748Z\" fill=\"#145439\"/>\n";
    let EXT = 0, LB = 0, W = 0, H = 0, u = 0, ox = 0, oy = 0, dpr = 1, size = 0, R = 0, S = [], archImg = null, landImg = null, raf = 0, idle = 0, drag = null, vis = false, started = false;
    let rects = [];
    /* landscape: a graph. Nodes and relationships spread along a floor, with the arch as the central node */
    const ROWS = 34; let EDGES = [];
    const REL = [':KNOWS', ':OWNS', ':PART_OF', ':DEPENDS_ON', ':AFFECTS', ':CREATED', ':USES', ':NEXT'];
    function buildLand(cols) {
      let seed = 23; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const cells = new Map(), add = (x, y, tg) => { if (x >= 0 && x < cols && y >= 0 && y < ROWS) cells.set(x + ',' + y, tg); };
      const cx = Math.floor(cols / 2); EDGES = [];
            CELLS.forEach((c) => { for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) add(cx - 18 + c.x * 3 + i, ROWS - (10 - c.y) * 3 + j, 'L'); });
      const hub = { x: cx, y: ROWS - 6, r: 0 }, nodes = [];
      const side = (dir) => { let x = cx + dir * 37, prev = hub, k = 0;
        while (x > 4 && x < cols - 4) { const r = 5, y = ROWS - 6, n = { x, y, r }; nodes.push(n); EDGES.push({ a: prev, b: n, l: REL[(k + (dir > 0 ? 3 : 0)) % REL.length] }); prev = n; x += dir * 21; k++; } };
      side(-1); side(1);
      nodes.forEach((n) => { for (let dy = -n.r; dy <= n.r; dy++) for (let dx = -n.r; dx <= n.r; dx++) if (dx * dx + dy * dy <= n.r * n.r + n.r) add(n.x + dx, n.y + dy, 'n'); });
      EDGES.forEach((e) => { const ax = e.a.x, ay = e.a.y, bx = e.b.x, by = e.b.y, L = Math.hypot(bx - ax, by - ay), st = Math.ceil(L); for (let i = 0; i <= st; i++) { const px = Math.round(ax + (bx - ax) * i / st), py = Math.round(ay + (by - ay) * i / st); if (!cells.has(px + ',' + py)) add(px, py, 'e'); } });
      return { cells };
    }
    function skyRects() { const cols = Math.ceil(W / u) + 1, sk = buildLand(cols); rects = []; sk.cells.forEach((tg, k) => { const [cx, cy] = k.split(',').map(Number); rects.push({ x: cx, y: cy, t: tg }); }); }
    function sticker(kind) {
      const tot = Math.round(size * dpr), c = document.createElement('canvas'); c.width = c.height = tot; const g = c.getContext('2d');
      const draw = (svg, x, y, w, h) => { const im = new Image(); im.onload = () => { g.drawImage(im, x, y, w, h); }; im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); };
      if (kind === 'archie') { const w = tot * .92, h = w * 457 / 570; draw('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 570 457">' + MASCOT + '</svg>', (tot - w) / 2, (tot - h) / 2, w, h); return c; }
      if (BI[kind]) { const iw = tot * .9; draw('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' + BI[kind] + '</svg>', (tot - iw) / 2, (tot - iw) / 2, iw, iw); return c; }
      return c;
    }
    function drawArch() {
      const s = getComputedStyle(document.documentElement), col = s.getPropertyValue('--line-strong').trim(), mut = s.getPropertyValue('--ink-muted').trim();
      const mk = () => { const c = document.createElement('canvas'); c.width = Math.ceil(W * dpr); c.height = Math.ceil(H * dpr); const g = c.getContext('2d'); g.scale(dpr, dpr); g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1.5; g.lineJoin = 'round'; g.lineCap = 'round'; return [c, g]; };
      const [ca, ga] = mk(), [cl, gl] = mk(); archImg = ca; landImg = cl;
      /* the arch: one smooth outline, outer dome and inner opening */
      { const cols = Math.ceil(W / u) + 1, cx = Math.floor(cols / 2), x0 = ox + (cx - 18) * u, w = 36 * u, top = oy + (ROWS - 30) * u, bot = oy + ROWS * u, R = w / 2, iw = w * .39, ir = iw / 2, ix = x0 + (w - iw) / 2, itop = top + (bot - top) * .43;
        ga.beginPath(); ga.moveTo(x0, bot); ga.lineTo(x0, top + R); ga.arc(x0 + R, top + R, R, Math.PI, 0); ga.lineTo(x0 + w, bot);
        ga.moveTo(ix, bot); ga.lineTo(ix, itop + ir); ga.arc(ix + ir, itop + ir, ir, Math.PI, 0); ga.lineTo(ix + iw, bot); ga.stroke(); }
      gl.beginPath(); gl.moveTo(0, H - .75); gl.lineTo(W, H - .75); gl.stroke();
      /* graph: circles joined by straight relationships with a chevron head and a Cypher-style type label */
      gl.font = '500 11px ' + (getComputedStyle(document.body).getPropertyValue('--mono') || 'monospace'); gl.textAlign = 'center';
      const seen = new Set(); EDGES.forEach((e) => [e.a, e.b].forEach((n) => { if (n.r && !seen.has(n)) { seen.add(n); gl.beginPath(); gl.arc(ox + (n.x + .5) * u, oy + (n.y + .5) * u, (n.r + .5) * u, 0, Math.PI * 2); gl.stroke(); } }));
      EDGES.forEach((e) => { const ax = ox + (e.a.x + .5) * u, ay = oy + (e.a.y + .5) * u, bx = ox + (e.b.x + .5) * u, by = oy + (e.b.y + .5) * u, ang = Math.atan2(by - ay, bx - ax), ra = e.a.r ? (e.a.r + 1.2) * u : 19.5 * u, rb = (e.b.r + 1.6) * u;
        const x0 = ax + Math.cos(ang) * ra, y0 = ay + Math.sin(ang) * ra, x1 = bx - Math.cos(ang) * rb, y1 = by - Math.sin(ang) * rb;
        gl.beginPath(); gl.lineWidth = 1.25; gl.moveTo(x0, y0); gl.lineTo(x1, y1); gl.stroke();
        gl.beginPath(); [-.62, .62].forEach((da) => { gl.moveTo(x1, y1); gl.lineTo(x1 - Math.cos(ang + da) * 9, y1 - Math.sin(ang + da) * 9); }); gl.stroke(); gl.lineWidth = 1.5;
        gl.save(); gl.fillStyle = mut; gl.globalAlpha = .8; gl.fillText(e.l, (x0 + x1) / 2, (y0 + y1) / 2 - 8); gl.restore(); });
    }
    function spawn() {
      S.forEach((s, i) => { s.x = R + Math.random() * (W - R * 2); s.y = -R - i * size * .9; s.vx = (Math.random() - .5) * 70; s.vy = 150 + Math.random() * 90; s.a = Math.random() * 6.28; s.w = (Math.random() - .5) * 1.2; s.in = false; });
      kick();
    }
    function layout() {
      W = box.clientWidth; if (!W) return; dpr = Math.min(devicePixelRatio || 1, 2);
      u = W < 700 ? 8 : 11; const PH = Math.round(ROWS * u + (W < 700 ? 150 : 170)); box.style.height = PH + 'px'; EXT = box.offsetTop; H = PH + EXT; ox = 0; oy = H - ROWS * u; skyRects();
      const px = W < 700 ? 2.5 : 4; size = (20) * px; R = size * .42; cv.style.top = -EXT + 'px'; cv.style.height = H + 'px'; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const keep = S.map((s) => ({ x: s.x / (S.W || W), y: s.y / (S.H || H), vx: 0, vy: 0, a: s.a, w: 0, in: s.in }));
      S = KINDS.map((k, i) => Object.assign({ k, img: sticker(k, px), x: 0, y: 0, vx: 0, vy: 0, a: 0, w: 0, in: false }, keep[i] || {}));
      if (keep.length) S.forEach((s, i) => { s.x = keep[i].x * W; s.y = keep[i].y * H; }); S.W = W; S.H = H;
      { const fg = document.querySelector('.fgrid'), top = box.getBoundingClientRect().top - EXT; LB = fg ? fg.getBoundingClientRect().bottom - top : EXT * .7; const m = 'linear-gradient(to bottom, transparent ' + Math.round(LB) + 'px, #000 ' + Math.round(LB + 90) + 'px)'; cv.style.webkitMaskImage = cv.style.maskImage = m; }
      drawArch(); if (!keep.length) { spawn(); if (RM) { for (let i = 0; i < 900; i++) step(1 / 120); render(); idle = 99; } } else { kick(); }
    }
    function pushCircleRect(s, r) {
      const rx = ox + r.x * u, ry = oy + r.y * u, cx = Math.max(rx, Math.min(s.x, rx + u)), cy = Math.max(ry, Math.min(s.y, ry + u));
      let dx = s.x - cx, dy = s.y - cy, d = Math.hypot(dx, dy);
      if (d >= R) return;
      if (d === 0) { dx = 0; dy = -1; d = 1; const ex = Math.min(s.x - rx, rx + u - s.x), ey = Math.min(s.y - ry, ry + u - s.y); if (ex < ey) dx = s.x < rx + u / 2 ? -1 : 1, dy = 0; else dy = s.y < ry + u / 2 ? -1 : 1; }
      const nx = dx / d, ny = dy / d, ov = R - d; s.x += nx * ov; s.y += ny * ov;
      const vn = s.vx * nx + s.vy * ny; if (vn < 0) { s.vx -= 1.55 * vn * nx; s.vy -= 1.55 * vn * ny; s.w += (s.vx * ny - s.vy * nx) / R * .004; }
    }
    function step(dt) {
      S.forEach((s) => {
        if (s === drag) return;
        s.vy += 320 * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.a += s.w * dt;
        s.vx *= .9997; s.vy *= .9997; s.w *= .998; if (s.w > 1.6) s.w = 1.6; else if (s.w < -1.6) s.w = -1.6;
        const sp = Math.hypot(s.vx, s.vy);
        if (s.in) { if (sp < 26) { if (sp < 1) { const q = Math.random() * 6.283; s.vx = Math.cos(q) * 26; s.vy = Math.sin(q) * 26; } else { s.vx *= 26 / sp; s.vy *= 26 / sp; } } if (sp > 900) { s.vx *= 900 / sp; s.vy *= 900 / sp; } }
        if (s.y > R) s.in = true;
        if (s.x < R) { s.x = R; s.vx = Math.abs(s.vx) * .9; } if (s.x > W - R) { s.x = W - R; s.vx = -Math.abs(s.vx) * .9; }
        if (s.in && s.y < R) { s.y = R; s.vy = Math.abs(s.vy) * .9; }
        if (s.y > H - R) { s.y = H - R; s.vy = -Math.abs(s.vy) * .5; if (Math.abs(s.vy) < 45) s.vy = 0; s.vx *= .985; s.w *= .96; }
        rects.forEach((r) => pushCircleRect(s, r));
      });
      for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) {
        const a = S[i], b = S[j]; let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), m = R * 2 * .96;
        if (d >= m || d === 0) continue; const nx = dx / d, ny = dy / d, ov = m - d, ia = a === drag ? 0 : 1, ib = b === drag ? 0 : 1, t = ia + ib || 1;
        a.x -= nx * ov * ia / t; a.y -= ny * ov * ia / t; b.x += nx * ov * ib / t; b.y += ny * ov * ib / t;
        const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (vn < 0) { const J = -(1 + .7) * vn / t; a.vx -= J * nx * ia; a.vy -= J * ny * ia; b.vx += J * nx * ib; b.vy += J * ny * ib; a.w += ny * .15; b.w -= ny * .15; }
      }
    }
    function render() {
      ctx.clearRect(0, 0, W, H); ctx.imageSmoothingEnabled = true;
      if (archImg) {
        ctx.drawImage(landImg, 0, 0, W, H);
        const N = echo.g.length, bx = W / 2, by = oy + ROWS * u;
        for (let k = N; k >= 1; k--) {
          const g = echo.g[k - 1], f = k / N, lag = .26 - k * .025;
          g.x += ((echo.on ? echo.tx * f : 0) - g.x) * lag;
          g.y += ((echo.on ? echo.ty * f : 0) - g.y) * lag;
          g.a += ((echo.on ? .42 * (1 - f * .75) : 0) - g.a) * .14;
          if (g.a < .01) continue;
          const sc = 1 - f * .3;
          ctx.save(); ctx.globalAlpha = g.a; ctx.translate(g.x, g.y); ctx.translate(bx, by); ctx.scale(sc, sc); ctx.translate(-bx, -by); ctx.drawImage(archImg, 0, 0, W, H); ctx.restore();
        }
        ctx.drawImage(archImg, 0, 0, W, H);
      }
      S.forEach((s) => { const w = s.img.width / dpr; ctx.save(); ctx.translate(Math.round(s.x), Math.round(s.y)); ctx.rotate(s.a); ctx.drawImage(s.img, -w / 2, -w / 2, w, w); ctx.restore(); });
    }
    let last = 0;
    function frame(t) {
      raf = 0; if (!vis && !drag) { last = 0; return; }
      const dt = last ? Math.min(.04, (t - last) / 1000) : 1 / 60; last = t;
      for (let i = 0; i < 4; i++) step(dt / 4); render();
      raf = requestAnimationFrame(frame);
    }
    function kick() { idle = 0; if (!raf && !RM) raf = requestAnimationFrame(frame); else if (RM) { for (let i = 0; i < 3; i++) step(1 / 180); render(); } }
    const pt = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    let hist = [], off = [0, 0];
    const echo = { on: false, tx: 0, ty: 0, g: [] }; for (let k = 0; k < 6; k++) echo.g.push({ x: 0, y: 0, a: 0 });
    const FT = box.closest('footer') || box;
    FT.addEventListener('pointerdown', (e) => {
      const [x, y] = pt(e); if (y < LB + 30) return; let hit = null; for (let i = S.length - 1; i >= 0; i--) if (Math.hypot(S[i].x - x, S[i].y - y) < R * 1.15) { hit = S[i]; break; }
      if (!hit) return; drag = hit; S.splice(S.indexOf(hit), 1); S.push(hit); off = [hit.x - x, hit.y - y]; hist = [[x, y, performance.now()]]; hit.vx = hit.vy = 0; hit.in = true;
      FT.setPointerCapture(e.pointerId); FT.classList.add('grab'); kick(); if (e.pointerType !== 'touch') e.preventDefault();
    });
    FT.addEventListener('pointermove', (e) => {
      const [x, y] = pt(e);
      if (!drag) {
        let over = y > LB + 30 && S.some((s) => Math.hypot(s.x - x, s.y - y) < R * 1.15); FT.classList.toggle('over', over);
        return;
      }
      drag.x = Math.max(R, Math.min(W - R, x + off[0])); drag.y = Math.max(R, Math.min(H - R, y + off[1])); hist.push([x, y, performance.now()]); if (hist.length > 6) hist.shift(); kick();
    });
    function release(e) {
      if (!drag) return; const n = performance.now(), a = hist.find((p) => n - p[2] < 120) || hist[0], b = hist[hist.length - 1], dt = Math.max(16, b[2] - a[2]);
      drag.vx = Math.max(-1100, Math.min(1100, (b[0] - a[0]) / dt * 1000)); drag.vy = Math.max(-1100, Math.min(1100, (b[1] - a[1]) / dt * 1000)); drag.w = Math.max(-1.6, Math.min(1.6, drag.vx / R * .05));
      drag = null; FT.classList.remove('grab'); kick();
    }
    cv.addEventListener('pointerleave', () => { echo.on = false; });
    /* the echo reacts to the whole footer, not only the arch */
    (function(){
      const ft = box.closest('footer') || document.querySelector('footer'); if (!ft || RM) return;
      ft.addEventListener('pointermove', (e) => {
        if (drag || (e.pointerType && e.pointerType !== 'mouse')) return;
        const r = cv.getBoundingClientRect(), cx = r.left + W / 2, cy = r.top + oy + (ROWS - 15) * u, m = 6 * u;
        echo.tx = Math.max(-m, Math.min(m, (e.clientX - cx) * .2)); echo.ty = Math.max(-m * .8, Math.min(m * .8, (e.clientY - cy) * .2)); echo.on = true;
      }, { passive: true });
      ft.addEventListener('pointerleave', () => { echo.on = false; });
    })();
    FT.addEventListener('pointerup', release); FT.addEventListener('pointercancel', release);
    new IntersectionObserver((es) => es.forEach((e) => { vis = e.isIntersecting; if (vis) { if (!started) { started = true; spawn(); } kick(); } }), { threshold: .15 }).observe(box);
    new ResizeObserver(() => requestAnimationFrame(layout)).observe(box); new MutationObserver(() => { drawArch(); render(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    layout();
  })();
})();
