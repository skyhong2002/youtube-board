@once
    <style>
        .lineage { margin: 0 0 18px; padding: 0; }
        .lineage h2, .lineage h3, .lineage p { margin: 0; }
        .lineage h2 { font-size: 18px; line-height: 1.25; }
        .lineage h3 { margin-bottom: 10px; color: #344054; font-size: 14px; }
        .lineage p { color: var(--muted); line-height: 1.55; }
        .lineage code { display: inline-block; max-width: 100%; overflow-wrap: anywhere; color: #344054; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
        .lineage-toggle { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 14px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--text); text-align: left; cursor: pointer; }
        .lineage-toggle span { display: block; font-size: 15px; font-weight: 800; line-height: 1.25; }
        .lineage-toggle small { display: block; margin-top: 2px; color: var(--muted); font-size: 12px; font-weight: 600; line-height: 1.35; }
        .lineage-toggle strong { flex: 0 0 auto; color: var(--accent); font-size: 12px; font-weight: 800; }
        .lineage-toggle:hover { border-color: #b7ded6; background: #fbfffe; }
        .lineage-panel { margin-top: 8px; }
        .lineage-panel[hidden] { display: none; }
        .lineage-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 10px; }
        .lineage-ops { display: inline-flex; flex: 0 0 auto; align-items: center; min-height: 30px; padding: 5px 10px; border: 1px solid #b7ded6; border-radius: 6px; background: var(--accent-bg); color: var(--accent); font-size: 12px; font-weight: 700; }
        .lineage-flow { display: grid; gap: 8px; margin-bottom: 0; }
        .lineage-graph { min-height: 158px; overflow-x: auto; border: 1px solid var(--line); border-radius: 6px; background: #fbfcfe; }
        .lineage-graph svg { display: block; min-width: 760px; width: auto; height: auto; }
        .lineage-fallback { display: flex; align-items: stretch; gap: 8px; min-width: 760px; padding: 8px; }
        .lineage-node, .lineage-edge { min-height: 76px; border: 1px solid var(--line); border-radius: 6px; background: #f9fbfd; }
        .lineage-node { display: flex; flex: 0 0 148px; flex-direction: column; justify-content: center; gap: 4px; padding: 8px; }
        .lineage-node span { color: var(--text); font-weight: 800; line-height: 1.25; overflow-wrap: anywhere; }
        .lineage-node em { color: #475467; font-size: 11px; font-style: normal; font-weight: 700; line-height: 1.25; overflow-wrap: anywhere; }
        .lineage-node small { color: var(--muted); font-size: 11px; text-transform: uppercase; }
        .lineage-node-api { border-color: #a7c7e7; background: #edf6ff; }
        .lineage-node-table { border-color: #c7d7a7; background: #f5faec; }
        .lineage-node-cache { border-color: #e6c58f; background: #fff7e8; }
        .lineage-node-service { border-color: #b7ded6; background: var(--accent-bg); }
        .lineage-node-page { border-color: #c7b7df; background: #f5f0ff; }
        .lineage-node-fixed { border-color: #d0c4a8; background: #f9f4e8; }
        .lineage-edge { display: flex; flex: 0 0 64px; align-items: center; justify-content: center; color: var(--muted); font-size: 11px; font-weight: 700; text-align: center; position: relative; }
        .lineage-edge::before { content: ""; position: absolute; left: 8px; right: 8px; top: 50%; border-top: 1px solid #98a2b3; }
        .lineage-edge::after { content: ""; position: absolute; right: 8px; top: calc(50% - 4px); width: 8px; height: 8px; border-top: 1px solid #98a2b3; border-right: 1px solid #98a2b3; transform: rotate(45deg); background: transparent; }
        .lineage-edge span { position: relative; z-index: 1; padding: 2px 5px; background: #f9fbfd; }
        .lineage-svg-node { cursor: pointer; outline: none; }
        .lineage-svg-node rect { transition: stroke-width .12s ease, filter .12s ease; }
        .lineage-svg-node:hover rect, .lineage-svg-node:focus rect, .lineage-svg-node.is-active rect { filter: drop-shadow(0 2px 3px rgb(16 24 40 / 18%)); stroke-width: 2.4; }
        .lineage-detail { min-height: 128px; padding: 10px; border: 1px solid var(--line); border-radius: 6px; background: #fbfcfe; }
        .lineage-detail[hidden] { display: none; }
        .lineage-detail h3 { margin-bottom: 6px; font-size: 16px; }
        .lineage-detail p { margin-bottom: 8px; color: #344054; }
        .lineage dl { display: grid; gap: 6px; margin: 8px 0 0; }
        .lineage dl div { display: grid; grid-template-columns: 152px minmax(0, 1fr); gap: 8px; }
        .lineage dt { color: var(--muted); font-size: 12px; font-weight: 700; }
        .lineage dd { margin: 0; min-width: 0; color: #344054; line-height: 1.45; white-space: pre-line; }
        @media (max-width: 720px) { .lineage-toggle { align-items: flex-start; } .lineage-head { display: block; } .lineage-ops { margin-top: 10px; } .lineage dl div { grid-template-columns: 1fr; gap: 2px; } }
    </style>
@endonce
