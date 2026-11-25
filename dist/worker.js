/**
 * 班级聊天室 · Cloudflare Worker 版本
 *
 * - 同一个 Worker 既提供网页，也提供 WebSocket 接口
 * - 每个房间对应一个 Durable Object 实例，负责消息广播 + 历史记录
 * - 单文件，可由 build.mjs 把 public/index.html 内联进来后直接部署
 */

const PAGE = "﻿<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n<meta charset=\"utf-8\" />\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1\" />\n<meta name=\"theme-color\" content=\"#05060c\" />\n<meta name=\"color-scheme\" content=\"dark\" />\n<title>聊天室</title>\n<link rel=\"icon\" href=\"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='%237c6cff'/><stop offset='1' stop-color='%23ff5f9e'/></linearGradient></defs><rect width='100' height='100' rx='26' fill='url(%23g)'/><path d='M28 34h44v24H44l-10 9v-9h-6z' fill='white' fill-opacity='.95'/></svg>\" />\n<style>\n  :root {\n    --bg: #05060c;\n    --glass: rgba(255, 255, 255, .045);\n    --glass-2: rgba(255, 255, 255, .07);\n    --stroke: rgba(255, 255, 255, .09);\n    --stroke-2: rgba(255, 255, 255, .14);\n    --txt: #eef0f7;\n    --muted: rgba(238, 240, 247, .52);\n    --muted-2: rgba(238, 240, 247, .34);\n    --accent: #7c6cff;\n    --grad: linear-gradient(135deg, #7c6cff 0%, #a855f7 48%, #ff5f9e 100%);\n    --ok: #3ddc97;\n    --warn: #ffb443;\n    --bad: #ff5f6d;\n    --ease: cubic-bezier(.22, 1, .36, 1);\n    --spring: cubic-bezier(.34, 1.56, .64, 1);\n  }\n\n  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }\n  html, body {\n    height: 100%; width: 100%; max-width: 100%; overflow: hidden;\n    margin: 0; background: var(--bg); color: var(--txt);\n  }\n  body {\n    font: 15px/1.55 -apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"Segoe UI\", \"PingFang SC\", \"Hiragino Sans GB\", \"Microsoft YaHei\", sans-serif;\n    -webkit-font-smoothing: antialiased;\n    display: flex; flex-direction: column;\n    height: 100dvh;\n    position: relative;\n  }\n\n  /* ---------- 背景光晕 ---------- */\n  .aurora { position: fixed; inset: 0; overflow: hidden; pointer-events: none; z-index: 0; }\n  .aurora i {\n    position: absolute; display: block; border-radius: 50%;\n    filter: blur(70px); opacity: .55; will-change: transform;\n  }\n  .aurora i:nth-child(1) {\n    width: 68vmax; height: 68vmax; left: -22vmax; top: -30vmax;\n    background: radial-gradient(circle at 50% 50%, #5b4bff 0%, transparent 62%);\n    animation: drift1 26s ease-in-out infinite alternate;\n  }\n  .aurora i:nth-child(2) {\n    width: 58vmax; height: 58vmax; right: -24vmax; top: 4vmax;\n    background: radial-gradient(circle at 50% 50%, #a855f7 0%, transparent 62%);\n    opacity: .42; animation: drift2 32s ease-in-out infinite alternate;\n  }\n  .aurora i:nth-child(3) {\n    width: 62vmax; height: 62vmax; left: 8vmax; bottom: -34vmax;\n    background: radial-gradient(circle at 50% 50%, #1d6bff 0%, transparent 64%);\n    opacity: .35; animation: drift3 38s ease-in-out infinite alternate;\n  }\n  .aurora::after {\n    content: ''; position: absolute; inset: 0;\n    background: radial-gradient(120% 80% at 50% 0%, transparent 20%, rgba(5, 6, 12, .55) 62%, var(--bg) 100%);\n  }\n  @keyframes drift1 { from { transform: translate3d(0, 0, 0) scale(1); } to { transform: translate3d(6vmax, 5vmax, 0) scale(1.12); } }\n  @keyframes drift2 { from { transform: translate3d(0, 0, 0) scale(1.05); } to { transform: translate3d(-7vmax, 6vmax, 0) scale(.95); } }\n  @keyframes drift3 { from { transform: translate3d(0, 0, 0) scale(.98); } to { transform: translate3d(5vmax, -6vmax, 0) scale(1.1); } }\n\n  header, main, footer { position: relative; z-index: 1; }\n\n  /* ---------- 顶栏 ---------- */\n  header {\n    flex: none; display: flex; align-items: center; gap: 11px;\n    padding: calc(10px + env(safe-area-inset-top)) 14px 10px;\n    background: linear-gradient(180deg, rgba(5, 6, 12, .72), rgba(5, 6, 12, .28));\n    backdrop-filter: blur(18px) saturate(140%);\n    -webkit-backdrop-filter: blur(18px) saturate(140%);\n    border-bottom: 1px solid rgba(255, 255, 255, .055);\n    animation: fadeDown .5s var(--ease) both;\n  }\n  @keyframes fadeDown { from { opacity: 0; transform: translateY(-10px); } }\n\n  .avatar {\n    width: 38px; height: 38px; flex: none; border-radius: 13px;\n    background: var(--grad); display: grid; place-items: center;\n    font-size: 17px; font-weight: 700; color: #fff;\n    box-shadow: 0 8px 22px -8px rgba(124, 108, 255, .85), inset 0 1px 0 rgba(255, 255, 255, .35);\n    position: relative;\n  }\n  .avatar::after {\n    content: ''; position: absolute; inset: -1px; border-radius: 13px;\n    background: linear-gradient(160deg, rgba(255, 255, 255, .45), transparent 45%);\n    opacity: .5; pointer-events: none;\n  }\n\n  .head-txt { min-width: 0; flex: 1; }\n  .head-txt h1 {\n    margin: 0; font-size: 15.5px; font-weight: 650; letter-spacing: .2px;\n    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;\n  }\n  .meta { display: flex; align-items: center; gap: 6px; margin-top: 2px; }\n  .pulse {\n    width: 6px; height: 6px; border-radius: 50%; flex: none;\n    background: var(--warn); position: relative;\n  }\n  .pulse::after {\n    content: ''; position: absolute; inset: -4px; border-radius: 50%;\n    background: currentColor; opacity: .35; animation: ring 2.2s ease-out infinite;\n  }\n  .pulse.on { background: var(--ok); color: var(--ok); }\n  .pulse.bad { background: var(--bad); color: var(--bad); }\n  .pulse.hide::after { animation: none; opacity: 0; }\n  @keyframes ring { 0% { transform: scale(.5); opacity: .5; } 70% { transform: scale(1.6); opacity: 0; } 100% { opacity: 0; } }\n  #status { font-size: 11.5px; color: var(--muted); letter-spacing: .2px; }\n\n  .icon-btn {\n    appearance: none; height: 36px; min-width: 36px; padding: 0 11px;\n    display: inline-flex; align-items: center; justify-content: center; gap: 5px;\n    border-radius: 12px; border: 1px solid var(--stroke); background: var(--glass);\n    color: var(--txt); font: inherit; font-size: 12.5px; cursor: pointer;\n    backdrop-filter: blur(8px);\n    transition: transform .18s var(--ease), background .18s, border-color .18s, box-shadow .25s;\n  }\n  .icon-btn:hover { background: var(--glass-2); border-color: var(--stroke-2); }\n  .icon-btn:active { transform: scale(.94); }\n  .icon-btn svg { width: 16px; height: 16px; opacity: .9; }\n\n  /* ---------- 消息区 ---------- */\n  #list {\n    flex: 1; overflow-y: auto; overflow-x: hidden;\n    padding: 18px 14px 8px;\n    overscroll-behavior: contain; scrollbar-width: thin;\n    scrollbar-color: rgba(255, 255, 255, .14) transparent;\n    -webkit-overflow-scrolling: touch;\n    scroll-behavior: smooth;\n  }\n  #list::-webkit-scrollbar { width: 7px; }\n  #list::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, .12); border-radius: 8px; }\n\n  #inner { display: flex; flex-direction: column; gap: 3px; margin-top: auto; min-height: 100%; justify-content: flex-end; }\n\n  .day {\n    align-self: center; margin: 14px 0 10px; padding: 4px 12px;\n    font-size: 11.5px; color: var(--muted-2); letter-spacing: .4px;\n    background: rgba(255, 255, 255, .04); border: 1px solid rgba(255, 255, 255, .05);\n    border-radius: 999px; animation: fadeIn .35s var(--ease) both;\n  }\n\n  .msg {\n    display: flex; flex-direction: column; align-items: flex-start;\n    max-width: 78%; margin-top: 8px;\n    animation: pop .34s var(--ease) both;\n  }\n  @keyframes pop {\n    from { opacity: 0; transform: translateY(9px) scale(.97); }\n    to { opacity: 1; transform: none; }\n  }\n  @keyframes fadeIn { from { opacity: 0; } }\n\n  .who {\n    font-size: 11.5px; margin: 0 12px 4px; letter-spacing: .2px;\n    color: var(--muted);\n  }\n\n  .bubble {\n    position: relative; padding: 9px 13px; border-radius: 17px;\n    font-size: 14.5px; line-height: 1.5;\n    word-break: break-word; overflow-wrap: anywhere; white-space: pre-wrap;\n    background: var(--glass-2);\n    border: 1px solid var(--stroke);\n    backdrop-filter: blur(10px);\n    box-shadow: 0 6px 18px -14px rgba(0, 0, 0, .9);\n    transition: transform .2s var(--ease), box-shadow .25s var(--ease);\n  }\n  .msg.them .bubble { border-bottom-left-radius: 6px; }\n  .msg:hover .bubble { transform: translateY(-1px); box-shadow: 0 12px 26px -18px rgba(0, 0, 0, 1); }\n\n  .msg.me { align-items: flex-end; margin-left: auto; }\n  .msg.me .bubble {\n    color: #fff; border: 0; border-bottom-right-radius: 6px;\n    background: var(--grad);\n    box-shadow: 0 10px 26px -14px rgba(140, 96, 255, .9), inset 0 1px 0 rgba(255, 255, 255, .28);\n  }\n  .msg.me + .msg.me .bubble { border-top-right-radius: 8px; }\n  .msg.them + .msg.them .bubble { border-top-left-radius: 8px; }\n  .msg.me + .msg.me .bubble { margin-top: -1px; }\n\n  .msg.system { align-self: center; max-width: 92%; margin: 10px 0; }\n  .msg.system .bubble {\n    background: rgba(255, 255, 255, .035); border: 1px dashed rgba(255, 255, 255, .1);\n    color: var(--muted); font-size: 12px; padding: 4px 12px; border-radius: 999px;\n    backdrop-filter: none; box-shadow: none;\n  }\n  .msg.system:hover .bubble { transform: none; }\n\n  /* 空状态 */\n  .empty {\n    margin: auto; padding: 26px 18px; text-align: center;\n    display: flex; flex-direction: column; align-items: center; gap: 6px;\n    animation: fadeIn .6s var(--ease) both;\n  }\n  .empty .art { width: 96px; height: 76px; position: relative; margin-bottom: 14px; }\n  .empty .art i {\n    position: absolute; display: block; border-radius: 14px;\n    animation: float 4.2s ease-in-out infinite;\n  }\n  .empty .art i:nth-child(1) {\n    width: 62px; height: 40px; left: 0; top: 20px;\n    background: rgba(255, 255, 255, .08); border: 1px solid rgba(255, 255, 255, .1);\n    border-bottom-left-radius: 6px;\n  }\n  .empty .art i:nth-child(2) {\n    width: 52px; height: 34px; right: 0; top: 0;\n    background: var(--grad); opacity: .9;\n    border-bottom-right-radius: 6px; animation-delay: -2.1s;\n    box-shadow: 0 10px 24px -14px rgba(140, 96, 255, .9);\n  }\n  .empty .art i:nth-child(3) {\n    width: 8px; height: 8px; left: 22px; top: 33px; border-radius: 50%;\n    background: rgba(255, 255, 255, .35); animation-delay: -1s;\n  }\n  @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }\n  .empty h2 { margin: 0; font-size: 16px; font-weight: 650; }\n  .empty p { margin: 0; font-size: 12.5px; color: var(--muted); line-height: 1.7; max-width: 260px; }\n  .empty button {\n    margin-top: 14px; height: 38px; padding: 0 16px; border-radius: 12px;\n    border: 1px solid var(--stroke-2); background: rgba(255, 255, 255, .06);\n    color: var(--txt); font: inherit; font-size: 13px; cursor: pointer;\n    transition: transform .18s var(--ease), background .18s;\n  }\n  .empty button:hover { background: rgba(255, 255, 255, .1); }\n  .empty button:active { transform: scale(.96); }\n\n  /* 正在输入 */\n  #typing {\n    display: none; align-items: center; gap: 7px; margin: 8px 4px 0;\n    font-size: 12px; color: var(--muted); animation: fadeIn .3s var(--ease) both;\n  }\n  #typing.show { display: flex; }\n  .dots { display: inline-flex; gap: 3px; }\n  .dots s {\n    width: 4px; height: 4px; border-radius: 50%; background: var(--muted);\n    animation: bob 1.15s infinite ease-in-out;\n  }\n  .dots s:nth-child(2) { animation-delay: .15s; }\n  .dots s:nth-child(3) { animation-delay: .3s; }\n  @keyframes bob { 0%, 60%, 100% { transform: translateY(0); opacity: .45; } 30% { transform: translateY(-3px); opacity: 1; } }\n\n  /* 回到底部 */\n  #down {\n    position: fixed; right: 16px; bottom: calc(96px + env(safe-area-inset-bottom));\n    z-index: 5; width: 42px; height: 42px; border-radius: 50%;\n    border: 1px solid var(--stroke-2); background: rgba(20, 22, 34, .82);\n    backdrop-filter: blur(14px); color: var(--txt); cursor: pointer;\n    display: grid; place-items: center;\n    box-shadow: 0 14px 30px -12px rgba(0, 0, 0, .9);\n    opacity: 0; transform: translateY(12px) scale(.9); pointer-events: none;\n    transition: opacity .25s var(--ease), transform .3s var(--spring), background .2s;\n  }\n  #down.show { opacity: 1; transform: none; pointer-events: auto; }\n  #down:active { transform: scale(.92); }\n  #down .badge {\n    position: absolute; top: -4px; right: -4px; min-width: 18px; height: 18px;\n    border-radius: 9px; background: var(--grad); color: #fff;\n    font-size: 10.5px; font-weight: 700; display: grid; place-items: center; padding: 0 5px;\n    box-shadow: 0 4px 10px -4px rgba(0, 0, 0, .8);\n  }\n  #down .badge:empty { display: none; }\n\n  /* ---------- 输入区 ---------- */\n  footer {\n    flex: none; padding: 8px 12px calc(10px + env(safe-area-inset-bottom));\n    animation: slideUp .55s var(--ease) both;\n  }\n  @keyframes slideUp { from { opacity: 0; transform: translateY(14px); } }\n\n  .composer {\n    display: flex; align-items: flex-end; gap: 8px;\n    padding: 6px 6px 6px 14px; border-radius: 22px;\n    background: rgba(18, 20, 30, .72);\n    border: 1px solid var(--stroke);\n    backdrop-filter: blur(20px) saturate(140%);\n    -webkit-backdrop-filter: blur(20px) saturate(140%);\n    box-shadow: 0 16px 40px -22px rgba(0, 0, 0, 1), inset 0 1px 0 rgba(255, 255, 255, .05);\n    transition: border-color .25s var(--ease), box-shadow .3s var(--ease);\n  }\n  .composer:focus-within {\n    border-color: rgba(124, 108, 255, .55);\n    box-shadow: 0 0 0 4px rgba(124, 108, 255, .1), 0 16px 40px -22px rgba(0, 0, 0, 1);\n  }\n  #text {\n    flex: 1; min-width: 0; resize: none; max-height: 116px; min-height: 30px;\n    padding: 6px 0; border: 0; background: transparent; color: var(--txt);\n    font: inherit; font-size: 15px; line-height: 1.45; outline: none;\n  }\n  #text::placeholder { color: var(--muted-2); }\n  .counter {\n    align-self: center; font-size: 11px; color: var(--muted-2);\n    padding-right: 2px; opacity: 0; transition: opacity .2s;\n    font-variant-numeric: tabular-nums;\n  }\n  .counter.show { opacity: 1; }\n  .counter.hot { color: var(--warn); }\n\n  #send {\n    flex: none; width: 40px; height: 40px; border-radius: 15px; border: 0;\n    display: grid; place-items: center; cursor: pointer; color: #fff;\n    background: var(--grad);\n    box-shadow: 0 10px 22px -12px rgba(140, 96, 255, .95), inset 0 1px 0 rgba(255, 255, 255, .3);\n    transition: transform .2s var(--spring), filter .2s, opacity .2s;\n  }\n  #send svg { width: 19px; height: 19px; transition: transform .25s var(--spring); }\n  #send:hover { filter: brightness(1.08); }\n  #send:hover svg { transform: translateX(2px) rotate(-8deg); }\n  #send:active { transform: scale(.9); }\n  #send:disabled { opacity: .45; filter: grayscale(.3); transform: none; cursor: default; }\n\n  /* ---------- 弹层 ---------- */\n  .sheet {\n    position: fixed; inset: 0; z-index: 30; display: none;\n    align-items: center; justify-content: center; padding: 20px;\n    background: rgba(4, 5, 10, .6);\n    backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);\n    overflow-y: auto;\n  }\n  .sheet.show { display: flex; animation: fadeIn .25s var(--ease) both; }\n  .card {\n    width: 100%; max-width: 356px; flex: none; padding: 24px;\n    background:\n      radial-gradient(130% 100% at 50% -30%, rgba(124, 108, 255, .3), transparent 62%),\n      linear-gradient(180deg, rgba(27, 29, 43, .97), rgba(15, 16, 26, .98));\n    border: 1px solid var(--stroke-2); border-radius: 24px;\n    box-shadow: 0 30px 80px -30px rgba(0, 0, 0, 1), inset 0 1px 0 rgba(255, 255, 255, .1);\n    animation: cardIn .42s var(--spring) both;\n  }\n  @keyframes cardIn { from { opacity: 0; transform: translateY(22px) scale(.95); } }\n  .card h2 { margin: 0 0 6px; font-size: 17px; font-weight: 680; letter-spacing: .2px; }\n  .card .hint { margin: 0 0 18px; font-size: 12.5px; line-height: 1.65; color: var(--muted); }\n  .card .hint b { color: rgba(238, 240, 247, .8); font-weight: 600; }\n  .field { position: relative; margin-bottom: 12px; }\n  .field input {\n    width: 100%; height: 46px; padding: 0 14px; border-radius: 14px;\n    border: 1px solid var(--stroke); background: rgba(255, 255, 255, .04);\n    color: var(--txt); font: inherit; font-size: 15px; outline: none;\n    transition: border-color .2s, background .2s, box-shadow .2s;\n  }\n  .field input::placeholder { color: var(--muted-2); }\n  .field input:focus {\n    border-color: rgba(124, 108, 255, .6); background: rgba(255, 255, 255, .06);\n    box-shadow: 0 0 0 4px rgba(124, 108, 255, .1);\n  }\n  .row { display: flex; gap: 8px; }\n  .btn {\n    flex: 1; height: 46px; border-radius: 14px; border: 1px solid var(--stroke);\n    background: rgba(255, 255, 255, .05); color: var(--txt);\n    font: inherit; font-size: 14.5px; font-weight: 620; cursor: pointer;\n    transition: transform .18s var(--ease), background .18s, filter .18s;\n  }\n  .btn:hover { background: rgba(255, 255, 255, .09); }\n  .btn:active { transform: scale(.97); }\n  .btn.primary {\n    border: 0; color: #fff; background: var(--grad);\n    box-shadow: 0 12px 26px -14px rgba(140, 96, 255, .95), inset 0 1px 0 rgba(255, 255, 255, .3);\n  }\n  .btn.primary:hover { filter: brightness(1.07); }\n  .label { font-size: 11.5px; color: var(--muted-2); margin: 16px 0 7px; letter-spacing: .3px; }\n\n  /* ---------- 提示 ---------- */\n  .toast {\n    position: fixed; left: 50%; bottom: calc(96px + env(safe-area-inset-bottom));\n    z-index: 40; transform: translate(-50%, 14px); opacity: 0; pointer-events: none;\n    padding: 9px 16px; border-radius: 999px; font-size: 13px; max-width: 78vw;\n    text-align: center; background: rgba(28, 30, 44, .96); color: var(--txt);\n    border: 1px solid var(--stroke-2);\n    box-shadow: 0 18px 40px -18px rgba(0, 0, 0, 1);\n    transition: opacity .28s var(--ease), transform .34s var(--spring);\n  }\n  .toast.show { opacity: 1; transform: translate(-50%, 0); }\n\n  @media (prefers-reduced-motion: reduce) {\n    *, *::before, *::after { animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; }\n    #list { scroll-behavior: auto; }\n  }\n  @media (min-width: 720px) {\n    #list { padding-inline: max(14px, calc(50% - 340px)); }\n    footer { padding-inline: max(12px, calc(50% - 360px)); }\n    .msg { max-width: 62%; }\n  }\n</style>\n</head>\n<body>\n<div class=\"aurora\" aria-hidden=\"true\"><i></i><i></i><i></i></div>\n\n<header>\n  <div class=\"avatar\" id=\"avatar\">聊</div>\n  <div class=\"head-txt\">\n    <h1 id=\"roomName\">聊天室</h1>\n    <div class=\"meta\"><span class=\"pulse\" id=\"pulse\"></span><span id=\"status\">正在连接…</span></div>\n  </div>\n  <button class=\"icon-btn\" id=\"btnRoom\" title=\"切换房间\">\n    <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\"><path d=\"M4 7h16M4 12h10M4 17h13\"/></svg>\n    房间\n  </button>\n  <button class=\"icon-btn\" id=\"btnShare\" title=\"复制分享链接\">\n    <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"18\" cy=\"5\" r=\"3\"/><circle cx=\"6\" cy=\"12\" r=\"3\"/><circle cx=\"18\" cy=\"19\" r=\"3\"/><path d=\"M8.6 13.5l6.8 4M15.4 6.5l-6.8 4\"/></svg>\n    分享\n  </button>\n</header>\n\n<main id=\"list\">\n  <div id=\"inner\"></div>\n</main>\n\n<div id=\"typing\"><span class=\"dots\"><s></s><s></s><s></s></span><span id=\"typingText\"></span></div>\n\n<button id=\"down\" title=\"回到最新消息\">\n  <svg viewBox=\"0 0 24 24\" width=\"18\" height=\"18\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 5v14M6 13l6 6 6-6\"/></svg>\n  <span class=\"badge\" id=\"badge\"></span>\n</button>\n\n<footer>\n  <div class=\"composer\">\n    <textarea id=\"text\" rows=\"1\" placeholder=\"说点什么…\" enterkeyhint=\"send\" maxlength=\"500\"></textarea>\n    <span class=\"counter\" id=\"counter\">0/500</span>\n    <button id=\"send\" title=\"发送\">\n      <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4.5 12.5l15-7-5 15-3.6-5.4-6.4-2.6z\"/></svg>\n    </button>\n  </div>\n</footer>\n\n<div class=\"sheet\" id=\"nameSheet\">\n  <div class=\"card\">\n    <h2>先起个名字</h2>\n    <p class=\"hint\">给自己取个昵称，同学才认得出你。之后可以在右上角 <b>房间</b> 里随时改。</p>\n    <div class=\"field\"><input id=\"nameInput\" maxlength=\"16\" placeholder=\"例如：小明\" autocomplete=\"nickname\" /></div>\n    <div class=\"row\"><button class=\"btn primary\" id=\"nameOk\">进入聊天室</button></div>\n  </div>\n</div>\n\n<div class=\"sheet\" id=\"roomSheet\">\n  <div class=\"card\">\n    <h2>房间</h2>\n    <p class=\"hint\">只有房间号相同的人才能看到彼此的消息。把房间号当密码用，只有知道的人进得来。</p>\n    <div class=\"field\"><input id=\"roomInput\" maxlength=\"24\" placeholder=\"例如：banji-2\" /></div>\n    <div class=\"label\">昵称</div>\n    <div class=\"field\"><input id=\"nameInput2\" maxlength=\"16\" placeholder=\"昵称\" /></div>\n    <div class=\"row\">\n      <button class=\"btn\" id=\"roomClose\">关闭</button>\n      <button class=\"btn primary\" id=\"roomJoin\">进入</button>\n    </div>\n  </div>\n</div>\n\n<div class=\"toast\" id=\"toast\"></div>\n\n<script>\n(() => {\n  'use strict';\n  const $ = (id) => document.getElementById(id);\n  const list = $('list');\n  const inner = $('inner');\n  const textEl = $('text');\n  const sendBtn = $('send');\n  const pulse = $('pulse');\n  const statusEl = $('status');\n  const roomNameEl = $('roomName');\n  const avatarEl = $('avatar');\n  const typingEl = $('typing');\n  const typingText = $('typingText');\n  const downBtn = $('down');\n  const badgeEl = $('badge');\n  const counterEl = $('counter');\n\n  const MAX_LEN = 500;\n  const params = new URLSearchParams(location.search);\n  const store = {\n    get name() { return localStorage.getItem('chat.name') || ''; },\n    set name(v) { localStorage.setItem('chat.name', v); },\n    get room() { return localStorage.getItem('chat.room') || ''; },\n    set room(v) { localStorage.setItem('chat.room', v); },\n  };\n\n  let room = (params.get('room') || store.room || 'main').trim().slice(0, 24) || 'main';\n  let me = store.name;\n  const urlName = (params.get('name') || '').trim().slice(0, 16);\n  if (urlName) { me = urlName; store.name = urlName; }\n\n  let ws = null;\n  let retry = 0;\n  let retryTimer = null;\n  let seen = new Set();\n  let lastTs = 0;\n  let lastAuthor = '';\n  let stick = true;\n  let unread = 0;\n  let typingTimer = null;\n  let lastTypingSent = 0;\n  const typingUsers = new Map();\n\n  /* ---------- 小工具 ---------- */\n  const toastEl = $('toast');\n  function toast(msg) {\n    toastEl.textContent = msg;\n    toastEl.classList.add('show');\n    clearTimeout(toast._t);\n    toast._t = setTimeout(() => toastEl.classList.remove('show'), 1900);\n  }\n\n  function setStatus(kind, text) {\n    pulse.className = 'pulse' + (kind ? ' ' + kind : '');\n    statusEl.textContent = text;\n  }\n\n  function hueFor(name) {\n    let h = 0;\n    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;\n    return h;\n  }\n  const fmtTime = (ts) => {\n    const d = new Date(ts);\n    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');\n  };\n  const sameDay = (a, b) => a && new Date(a).toDateString() === new Date(b).toDateString();\n  const dayLabel = (ts) => {\n    const d = new Date(ts);\n    return d.toDateString() === new Date().toDateString() ? '今天' : `${d.getMonth() + 1}月${d.getDate()}日`;\n  };\n\n  /* ---------- 渲染 ---------- */\n  function clearAll() {\n    inner.innerHTML = '';\n    seen = new Set();\n    lastTs = 0;\n    lastAuthor = '';\n    unread = 0;\n    updateDown();\n    renderEmpty();\n  }\n\n  function renderEmpty() {\n    const box = document.createElement('div');\n    box.className = 'empty';\n    box.id = 'emptyState';\n    box.innerHTML = `\n      <div class=\"art\" aria-hidden=\"true\"><i></i><i></i><i></i></div>\n      <h2>把网址发给同学</h2>\n      <p>同一个房间的人才能互相看见消息。房间号就是暗号，只有知道的人能进来。</p>\n      <button type=\"button\" id=\"emptyShare\">复制邀请链接</button>`;\n    inner.appendChild(box);\n    box.querySelector('#emptyShare').addEventListener('click', doShare);\n  }\n\n  function removeEmpty() {\n    const el = inner.querySelector('.empty');\n    if (el) el.remove();\n  }\n\n  function addSystem(text) {\n    removeEmpty();\n    const msg = document.createElement('div');\n    msg.className = 'msg system';\n    const b = document.createElement('div');\n    b.className = 'bubble';\n    b.textContent = text;\n    msg.appendChild(b);\n    inner.appendChild(msg);\n    trim();\n    scrollToEnd();\n  }\n\n  function addMessage(m) {\n    if (!m || seen.has(m.id)) return;\n    seen.add(m.id);\n    removeEmpty();\n\n    if (!sameDay(lastTs, m.ts)) {\n      const day = document.createElement('div');\n      day.className = 'day';\n      day.textContent = dayLabel(m.ts);\n      inner.appendChild(day);\n      lastAuthor = '';\n    }\n    lastTs = m.ts;\n\n    const isMe = m.name === me;\n    const gap = lastTs ? m.ts - lastTs : Infinity;\n    const grouped = lastAuthor === m.name && gap < 120000;\n\n    const wrap = document.createElement('div');\n    wrap.className = 'msg ' + (isMe ? 'me' : 'them');\n\n    if (!isMe && !grouped) {\n      const who = document.createElement('div');\n      who.className = 'who';\n      who.textContent = m.name;\n      who.style.color = `hsl(${hueFor(m.name)} 78% 74%)`;\n      wrap.appendChild(who);\n    }\n\n    const bubble = document.createElement('div');\n    bubble.className = 'bubble';\n    bubble.textContent = m.text;\n    bubble.title = fmtTime(m.ts);\n    wrap.appendChild(bubble);\n    inner.appendChild(wrap);\n    lastAuthor = m.name;\n\n    trim();\n    if (stick) scrollToEnd();\n    else { unread++; updateDown(); }\n  }\n\n  function trim() {\n    while (inner.children.length > 500) inner.removeChild(inner.firstElementChild);\n  }\n\n  function nearBottom() {\n    return list.scrollHeight - list.scrollTop - list.clientHeight < 140;\n  }\n  let autoScroll = false;\n  function scrollToEnd(smooth = true) {\n    stick = true;\n    unread = 0;\n    autoScroll = true;\n    updateDown();\n    requestAnimationFrame(() => {\n      list.scrollTo({ top: list.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });\n      setTimeout(() => { autoScroll = false; }, smooth ? 700 : 60);\n    });\n  }\n  function updateDown() {\n    const show = !stick && (unread > 0 || list.scrollHeight - list.scrollTop - list.clientHeight > 200);\n    downBtn.classList.toggle('show', show);\n    badgeEl.textContent = unread > 99 ? '99+' : (unread > 0 ? String(unread) : '');\n  }\n\n  list.addEventListener('scroll', () => {\n    if (autoScroll) return;\n    const nb = nearBottom();\n    stick = nb;\n    if (nb) unread = 0;\n    updateDown();\n  }, { passive: true });\n\n  downBtn.addEventListener('click', () => scrollToEnd(true));\n\n  /* ---------- 正在输入 ---------- */\n  function showTyping(name) {\n    typingUsers.set(name, Date.now());\n    renderTyping();\n  }\n  function renderTyping() {\n    const now = Date.now();\n    for (const [k, t] of typingUsers) if (now - t > 2600) typingUsers.delete(k);\n    const names = [...typingUsers.keys()];\n    if (!names.length) { typingEl.classList.remove('show'); return; }\n    typingText.textContent = names.length === 1 ? `${names[0]} 正在输入` : `${names.length} 人正在输入`;\n    typingEl.classList.add('show');\n  }\n  setInterval(renderTyping, 900);\n\n  /* ---------- 连接 ---------- */\n  function wsUrl() {\n    const proto = location.protocol === 'https:' ? 'wss' : 'ws';\n    return `${proto}://${location.host}/api/ws?room=${encodeURIComponent(room)}`;\n  }\n\n  function connect() {\n    clearTimeout(retryTimer);\n    if (ws) { try { ws.onclose = null; ws.close(); } catch {} ws = null; }\n    setStatus('', retry ? '重新连接…' : '正在连接…');\n\n    let sock;\n    try { sock = new WebSocket(wsUrl()); } catch { return scheduleRetry(); }\n    ws = sock;\n\n    sock.onopen = () => {\n      retry = 0;\n      setStatus('on', '已连接');\n      sock.send(JSON.stringify({ t: 'hello', name: me || '匿名', room }));\n    };\n    sock.onmessage = (ev) => {\n      let d;\n      try { d = JSON.parse(ev.data); } catch { return; }\n      onServer(d);\n    };\n    sock.onclose = () => { setStatus('bad', '断开，重连中…'); scheduleRetry(); };\n    sock.onerror = () => { try { sock.close(); } catch {} };\n  }\n\n  // 心跳，顺便让 Cloudflare 别把空闲连接回收\n  setInterval(() => {\n    if (ws && ws.readyState === 1) {\n      try { ws.send('{\"t\":\"ping\"}'); } catch {}\n    }\n  }, 40000);\n\n  function scheduleRetry() {\n    retry = Math.min(retry + 1, 6);\n    const delay = Math.min(800 * Math.pow(1.7, retry), 8000);\n    clearTimeout(retryTimer);\n    retryTimer = setTimeout(connect, delay);\n  }\n\n  function onServer(d) {\n    switch (d.t) {\n      case 'init':\n        setStatus('on', d.online ? `${d.online} 人在线` : '已连接');\n        seen = new Set();\n        inner.innerHTML = '';\n        lastTs = 0;\n        lastAuthor = '';\n        if (!d.history || !d.history.length) renderEmpty();\n        else d.history.forEach(addMessage);\n        scrollToEnd(false);\n        break;\n      case 'msg':\n        addMessage(d.m);\n        break;\n      case 'presence':\n        if (ws && ws.readyState === 1) setStatus('on', d.online > 1 ? `${d.online} 人在线` : '已连接');\n        break;\n      case 'sys':\n        addSystem(d.text);\n        break;\n      case 'typing':\n        if (d.name && d.name !== me) showTyping(d.name);\n        break;\n      case 'err':\n        toast(d.msg || '出错了');\n        break;\n    }\n  }\n\n  /* ---------- 发送 ---------- */\n  function send() {\n    const text = textEl.value.trim();\n    if (!text) return;\n    if (!me) { openSheet($('nameSheet')); return; }\n    if (!ws || ws.readyState !== 1) { toast('还没连上，稍等一下'); return; }\n\n    ws.send(JSON.stringify({ t: 'msg', text }));\n    textEl.value = '';\n    autoGrow();\n    updateCounter();\n    if (!/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) textEl.focus();\n  }\n\n  function autoGrow() {\n    textEl.style.height = 'auto';\n    textEl.style.height = Math.min(textEl.scrollHeight, 116) + 'px';\n  }\n\n  function updateCounter() {\n    const n = textEl.value.length;\n    const show = n > 400;\n    counterEl.classList.toggle('show', show);\n    counterEl.classList.toggle('hot', n > 470);\n    if (show) counterEl.textContent = `${n}/${MAX_LEN}`;\n  }\n\n  textEl.addEventListener('input', () => {\n    autoGrow();\n    updateCounter();\n    const now = Date.now();\n    if (ws && ws.readyState === 1 && textEl.value && now - lastTypingSent > 1600) {\n      lastTypingSent = now;\n      ws.send(JSON.stringify({ t: 'typing' }));\n    }\n  });\n\n  textEl.addEventListener('keydown', (e) => {\n    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }\n  });\n  textEl.addEventListener('paste', () => setTimeout(() => { autoGrow(); updateCounter(); }, 0));\n  sendBtn.addEventListener('click', send);\n\n  /* ---------- 房间 / 昵称 ---------- */\n  function openSheet(el) {\n    el.classList.add('show');\n    const input = el.querySelector('input');\n    if (input) { input.value = input.dataset.prefill || input.value; setTimeout(() => input.focus(), 120); }\n  }\n  function closeSheet(el) { el.classList.remove('show'); }\n\n  function applyRoom() {\n    const label = room === 'main' ? '公共聊天室' : room;\n    roomNameEl.textContent = label;\n    avatarEl.textContent = (label[0] || '聊').toUpperCase();\n    document.title = label + ' · 聊天室';\n    const u = new URL(location.href);\n    u.searchParams.set('room', room);\n    u.searchParams.delete('name');\n    history.replaceState(null, '', u);\n    clearAll();\n    connect();\n  }\n\n  $('nameOk').addEventListener('click', () => {\n    const v = $('nameInput').value.trim().slice(0, 16);\n    if (!v) { toast('名字不能为空'); return; }\n    me = v; store.name = v;\n    closeSheet($('nameSheet'));\n    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'hello', name: v, room }));\n    else connect();\n    textEl.focus();\n  });\n  $('nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('nameOk').click(); });\n\n  $('btnRoom').addEventListener('click', () => {\n    $('roomInput').value = room;\n    $('nameInput2').value = me;\n    openSheet($('roomSheet'));\n  });\n  $('roomClose').addEventListener('click', () => closeSheet($('roomSheet')));\n  $('roomJoin').addEventListener('click', () => {\n    const v = $('roomInput').value.trim().replace(/\\s+/g, '-').slice(0, 24) || 'main';\n    const nm = $('nameInput2').value.trim().slice(0, 16);\n    if (nm) { me = nm; store.name = nm; }\n    room = v; store.room = v;\n    closeSheet($('roomSheet'));\n    applyRoom();\n    toast('已进入 ' + (v === 'main' ? '公共聊天室' : v));\n  });\n\n  async function doShare() {\n    const u = new URL(location.href);\n    u.searchParams.set('room', room);\n    const link = u.toString();\n    try {\n      if (navigator.share && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {\n        await navigator.share({ title: '来聊天', url: link });\n      } else {\n        await navigator.clipboard.writeText(link);\n        toast('链接已复制，发给同学吧');\n      }\n    } catch { toast('复制失败，请手动复制地址栏'); }\n  }\n  $('btnShare').addEventListener('click', doShare);\n\n  // 断线后回到前台自动重连\n  document.addEventListener('visibilitychange', () => {\n    if (document.visibilityState === 'visible' && (!ws || ws.readyState > 1)) connect();\n  });\n\n  /* ---------- 启动 ---------- */\n  if (!me) openSheet($('nameSheet'));\n  applyRoom();\n  setTimeout(autoGrow, 60);\n})();\n</script>\n</body>\n</html>\n";

const MAX_TEXT = 500;
const MAX_NAME = 16;
const KEEP = 200;
const RATE_WINDOW_MS = 5000;
const RATE_MAX = 15;

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

const HTML_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function cleanText(value, max) {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, max);
}

function cleanRoom(value) {
  const room = cleanText(value, 24).replace(/\s+/g, '-').toLowerCase();
  return room || 'main';
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/api/ws' || path === '/api/ws/') {
      const room = cleanRoom(url.searchParams.get('room'));
      const stub = env.ROOMS.get(env.ROOMS.idFromName(room));
      return stub.fetch(request);
    }

    if (path === '/api/health') {
      return json({ ok: true, service: 'class-chat', ts: Date.now() });
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('method not allowed', { status: 405 });
    }

    if (path === '/' || path === '/index.html' || path === '/chat') {
      return new Response(PAGE, { headers: HTML_HEADERS });
    }

    if (path === '/favicon.ico') {
      return new Response(null, { status: 204 });
    }

    return new Response('404 not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  },
};

export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.log = null;
    this.seq = 0;
    this.rate = new Map();
  }

  /* 懒加载历史记录（休眠唤醒后重新从存储里读） */
  async ensure() {
    if (this.log) return;
    const stored = await this.state.storage.get('log');
    this.log = Array.isArray(stored) ? stored.slice(-KEEP) : [];
    this.seq = this.log.length ? this.log[this.log.length - 1].id : 0;
  }

  online() {
    return this.state.getWebSockets().length;
  }

  broadcast(payload, except) {
    const data = JSON.stringify(payload);
    for (const socket of this.state.getWebSockets()) {
      if (socket === except) continue;
      try {
        socket.send(data);
      } catch {
        /* 连接已断，忽略 */
      }
    }
  }

  presence() {
    this.broadcast({ t: 'presence', online: this.online() });
  }

  async fetch(request) {
    const upgrade = (request.headers.get('Upgrade') || '').toLowerCase();
    if (upgrade !== 'websocket') {
      return new Response('expected websocket upgrade', { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    this.state.acceptWebSocket(server);
    server.serializeAttachment({ name: '匿名' });
    await this.ensure();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket, raw) {
    let data;
    try {
      data = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }
    if (!data || typeof data !== 'object') return;

    switch (data.t) {
      case 'hello':
        return this.onHello(socket, data);
      case 'msg':
        return this.onMessage(socket, data);
      case 'typing':
        return this.onTyping(socket);
      case 'ping':
        try {
          socket.send('{"t":"pong"}');
        } catch {
          /* ignore */
        }
        return;
      default:
        return;
    }
  }

  async onHello(socket, data) {
    await this.ensure();
    const name = cleanText(data.name, MAX_NAME) || '匿名';
    socket.serializeAttachment({ name });

    try {
      socket.send(
        JSON.stringify({
          t: 'init',
          online: this.online(),
          history: this.log.slice(-80),
          me: { name },
        })
      );
    } catch {
      return;
    }

    if (this.online() > 1) {
      this.broadcast({ t: 'sys', text: `${name} 加入了聊天` }, socket);
    }
    this.presence();
  }

  async onMessage(socket, data) {
    await this.ensure();

    const attachment = socket.deserializeAttachment() || {};
    const name = cleanText(attachment.name, MAX_NAME) || '匿名';
    const text = cleanText(data.text, MAX_TEXT);
    if (!text) return;

    // 防刷屏：同一连接 5 秒最多 15 条
    const now = Date.now();
    const stamps = (this.rate.get(socket) || []).filter((t) => now - t < RATE_WINDOW_MS);
    if (stamps.length >= RATE_MAX) {
      try {
        socket.send(JSON.stringify({ t: 'err', msg: '发太快了，歇一下' }));
      } catch {
        /* ignore */
      }
      return;
    }
    stamps.push(now);
    this.rate.set(socket, stamps);

    this.seq += 1;
    const message = { id: this.seq, name, text, ts: now };
    this.log.push(message);
    if (this.log.length > KEEP) this.log.splice(0, this.log.length - KEEP);

    this.broadcast({ t: 'msg', m: message });
    try {
      await this.state.storage.put('log', this.log);
    } catch {
      /* 存储失败不影响聊天 */
    }
  }

  onTyping(socket) {
    const attachment = socket.deserializeAttachment() || {};
    const name = cleanText(attachment.name, MAX_NAME) || '匿名';
    this.broadcast({ t: 'typing', name }, socket);
  }

  async webSocketClose(socket) {
    this.rate.delete(socket);
    try {
      socket.close(1000, 'bye');
    } catch {
      /* ignore */
    }
    this.presence();
  }

  async webSocketError(socket) {
    this.rate.delete(socket);
    this.presence();
  }
}
