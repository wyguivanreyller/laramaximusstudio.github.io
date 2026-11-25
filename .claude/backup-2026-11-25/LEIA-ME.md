# Backup e sessão leve (25/11/2026)

Antes da mudança: 421 plugins ativos (3.393 skills, 264 agentes, 462 servidores MCP), ~143k tokens de peso fixo.

## O que foi feito
- `.claude/settings.json` (deste projeto) desativa 365 plugins e bloqueia os conectores Sent, Zoom, Asana, n8n e Floot.
- Mantidos: social-media-skills, hyper-marketing (anúncios/Meta Ads), canva, copywriting, remotion, firecrawl, instagram, pdf-viewer, superpowers e utilitários leves.
- Conectores da conta (Google, Gmail, Drive, Agenda, Metricool, Canva, Magnific, Firecrawl, GitHub) continuam como estavam.
- Nada foi alterado na configuração da conta nem de outros projetos.

## Como voltar atrás (1 passo)
Apague `.claude/settings.json` deste projeto (ou renomeie para `settings.json.off`). A lista completa antes/depois está em `plugins-antes-e-depois.txt`.

## Como religar só um plugin
Troque `false` por `true` (ou apague a linha) do plugin em `enabledPlugins`.
