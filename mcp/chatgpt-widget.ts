import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js'
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js'

export const CHATGPT_WIDGET_TEMPLATE_URI = 'ui://widget/bearingbrain-hero-v2.html'

const BEARINGBRAIN_ORIGIN = 'https://bearingbrain.com'
const CHATGPT_BRAND_MARK_URL = `${BEARINGBRAIN_ORIGIN}/chatgpt-assets/bearingbrain-mark-transparent.png`
const CHATGPT_BRAND_WORDMARK_URL = `${BEARINGBRAIN_ORIGIN}/chatgpt-assets/bearingbrain-wordmark-transparent.png`
const CHATGPT_WIDGET_DOMAIN = BEARINGBRAIN_ORIGIN

type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>

type UiAction = {
  label: string
  url: string
}

type UiField = {
  label: string
  value: string
  tone?: string
}

type UiSection = {
  title: string
  fields?: UiField[]
}

type UiItem = {
  title: string
  subtitle?: string
  tone?: string
  fields?: UiField[]
}

type UiPayload = {
  widget: string
  title: string
  subtitle?: string
  summary?: string
  tone?: string
  primaryAction?: UiAction
  secondaryActions?: UiAction[]
  fields?: UiField[]
  sections?: UiSection[]
  items?: UiItem[]
}

type WidgetContext = {
  host: string
  locale?: string
  sessionId?: string
  conversationId?: string
}

export function registerBearingBrainChatGptWidget(server: McpServer) {
  server.registerResource(
    'bearingbrain-chatgpt-widget',
    CHATGPT_WIDGET_TEMPLATE_URI,
    {},
    async () => ({
      contents: [
        {
          uri: CHATGPT_WIDGET_TEMPLATE_URI,
          mimeType: 'text/html;profile=mcp-app',
          text: buildWidgetHtml(),
          _meta: {
            ui: {
              prefersBorder: true,
              csp: {
                connectDomains: [],
                resourceDomains: [BEARINGBRAIN_ORIGIN],
                redirect_domains: [BEARINGBRAIN_ORIGIN],
              },
            },
            'openai/widgetDescription': 'Shows compact BearingBrain result cards for buy recommendations, fitment verdicts, quote comparisons, and evidence-based identification.',
            'openai/widgetPrefersBorder': true,
            'openai/widgetCSP': {
              connect_domains: [],
              resource_domains: [BEARINGBRAIN_ORIGIN],
              redirect_domains: [BEARINGBRAIN_ORIGIN],
            },
            'openai/widgetDomain': CHATGPT_WIDGET_DOMAIN,
          },
        },
      ],
    })
  )
}

export function buildHeroToolDescriptorMeta(params: {
  invoking: string
  invoked: string
  widgetTitle: string
  useCase: string
  visibility?: string[]
  routingNotes?: string
}): Record<string, unknown> {
  const visibility = Array.isArray(params.visibility) && params.visibility.length
    ? params.visibility
    : ['model', 'app']

  return {
    ui: {
      resourceUri: CHATGPT_WIDGET_TEMPLATE_URI,
      visibility,
    },
    'openai/outputTemplate': CHATGPT_WIDGET_TEMPLATE_URI,
    'openai/visibility': visibility.includes('model') ? 'public' : 'private',
    'openai/toolInvocation/invoking': params.invoking,
    'openai/toolInvocation/invoked': params.invoked,
    'openai/widgetDescription': `${params.widgetTitle} — ${params.useCase}${params.routingNotes ? ` ${params.routingNotes}` : ''}`,
  }
}

export function buildWidgetResultMeta(
  toolName: string,
  structuredContent: unknown,
  extra: ToolExtra
): Record<string, unknown> | undefined {
  const ui = extractUiPayload(structuredContent)
  if (!ui) return undefined

  const context = buildWidgetContext(extra)
  const attributedUi = attributeUiPayload(ui, context, toolName)

  return {
    'bearingbrain/widget': {
      toolName,
      host: context.host,
      locale: context.locale,
      sessionId: context.sessionId ?? null,
      conversationId: context.conversationId ?? null,
      ui: attributedUi,
    },
  }
}

function extractUiPayload(structuredContent: unknown): UiPayload | null {
  if (!isRecord(structuredContent)) return null
  const ui = structuredContent.ui
  if (!isRecord(ui)) return null
  const widget = asString(ui.widget)
  const title = asString(ui.title)
  if (!widget || !title) return null

  return {
    widget,
    title,
    subtitle: asString(ui.subtitle),
    summary: asString(ui.summary),
    tone: asString(ui.tone),
    primaryAction: normalizeAction(ui.primaryAction),
    secondaryActions: normalizeActionList(ui.secondaryActions),
    fields: normalizeFieldList(ui.fields),
    sections: normalizeSectionList(ui.sections),
    items: normalizeItemList(ui.items),
  }
}

function buildWidgetContext(extra: ToolExtra): WidgetContext {
  const meta = isRecord(extra._meta) ? extra._meta : undefined
  const explicitHost = asString(meta?.['bearingbrain/host']) ?? asString(meta?.host)
  const host = explicitHost
    ? explicitHost.toLowerCase()
    : meta && Object.keys(meta).some((key) => key.startsWith('openai/'))
      ? 'chatgpt'
      : 'mcp'

  return {
    host,
    locale: asString(meta?.['openai/locale']) ?? asString(meta?.['webplus/i18n']),
    sessionId: extra.sessionId,
    conversationId:
      asString(meta?.['bearingbrain/conversationId'])
      ?? asString(meta?.conversationId)
      ?? asString(meta?.['openai/conversation_id'])
      ?? asString(meta?.['openai/conversationId']),
  }
}

function attributeUiPayload(ui: UiPayload, context: WidgetContext, toolName: string): UiPayload {
  return {
    ...ui,
    primaryAction: attributeAction(ui.primaryAction, context, toolName),
    secondaryActions: ui.secondaryActions
      ?.map((action) => attributeAction(action, context, toolName))
      .filter((action): action is UiAction => Boolean(action)),
  }
}

function attributeAction(action: UiAction | undefined, context: WidgetContext, toolName: string): UiAction | undefined {
  if (!action?.url) return undefined
  return {
    ...action,
    url: appendAttribution(action.url, context, toolName),
  }
}

function appendAttribution(rawUrl: string, context: WidgetContext, toolName: string): string {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return rawUrl

    if (!url.searchParams.get('host')) url.searchParams.set('host', context.host)
    if (!url.searchParams.get('surface')) url.searchParams.set('surface', context.host)
    if (!url.searchParams.get('utm_source')) url.searchParams.set('utm_source', context.host)
    if (!url.searchParams.get('utm_medium')) url.searchParams.set('utm_medium', 'ai_app')
    if (!url.searchParams.get('utm_campaign')) url.searchParams.set('utm_campaign', `bearingbrain_${context.host}_app`)
    if (!url.searchParams.get('bb_tool')) url.searchParams.set('bb_tool', toolName)
    if (context.sessionId && !url.searchParams.get('app_session_id')) {
      url.searchParams.set('app_session_id', context.sessionId)
    }
    if (context.conversationId && !url.searchParams.get('conversation_id')) {
      url.searchParams.set('conversation_id', context.conversationId)
    }
    return url.toString()
  } catch {
    return rawUrl
  }
}

function normalizeAction(value: unknown): UiAction | undefined {
  if (!isRecord(value)) return undefined
  const label = asString(value.label)
  const url = asString(value.url)
  if (!label || !url) return undefined
  return { label, url }
}

function normalizeActionList(value: unknown): UiAction[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.map((item) => normalizeAction(item)).filter((item): item is UiAction => Boolean(item))
  return items.length ? items : undefined
}

function normalizeField(value: unknown): UiField | undefined {
  if (!isRecord(value)) return undefined
  const label = asString(value.label)
  const fieldValue = asString(value.value)
  if (!label || !fieldValue) return undefined
  const tone = asString(value.tone)
  return tone ? { label, value: fieldValue, tone } : { label, value: fieldValue }
}

function normalizeFieldList(value: unknown): UiField[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.map((item) => normalizeField(item)).filter((item): item is UiField => Boolean(item))
  return items.length ? items : undefined
}

function normalizeSection(value: unknown): UiSection | undefined {
  if (!isRecord(value)) return undefined
  const title = asString(value.title)
  const fields = normalizeFieldList(value.fields)
  if (!title || !fields?.length) return undefined
  return { title, fields }
}

function normalizeSectionList(value: unknown): UiSection[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.map((item) => normalizeSection(item)).filter((item): item is UiSection => Boolean(item))
  return items.length ? items : undefined
}

function normalizeItem(value: unknown): UiItem | undefined {
  if (!isRecord(value)) return undefined
  const title = asString(value.title)
  const fields = normalizeFieldList(value.fields)
  if (!title || !fields?.length) return undefined
  const subtitle = asString(value.subtitle)
  const tone = asString(value.tone)
  return { title, subtitle, tone, fields }
}

function normalizeItemList(value: unknown): UiItem[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.map((item) => normalizeItem(item)).filter((item): item is UiItem => Boolean(item))
  return items.length ? items : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function buildWidgetHtml(): string {
  return String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>BearingBrain Widget</title>
    <style>
      :root {
        color-scheme: light dark;
        --bg: #ffffff;
        --panel: #ffffff;
        --panel-2: #f7f7f5;
        --text: #121212;
        --muted: #66655f;
        --line: rgba(18, 18, 18, 0.12);
        --line-strong: rgba(18, 18, 18, 0.2);
        --accent: #0f172a;
        --good: #0f766e;
        --good-bg: rgba(15, 118, 110, 0.10);
        --brand-filter: none;
        --caution: #9a6700;
        --caution-bg: rgba(154, 103, 0, 0.10);
        --danger: #b42318;
        --danger-bg: rgba(180, 35, 24, 0.10);
        --shadow: 0 1px 0 rgba(18, 18, 18, 0.04), 0 12px 30px rgba(18, 18, 18, 0.06);
      }

      :root[data-theme="dark"] {
        --bg: #121212;
        --panel: #171717;
        --panel-2: #1d1d1d;
        --text: #f5f5f3;
        --muted: #b8b7b0;
        --line: rgba(255, 255, 255, 0.10);
        --line-strong: rgba(255, 255, 255, 0.16);
        --accent: #f5f5f3;
        --good: #70d6c5;
        --good-bg: rgba(112, 214, 197, 0.12);
        --brand-filter: invert(1) brightness(1.15);
        --caution: #f5c66b;
        --caution-bg: rgba(245, 198, 107, 0.14);
        --danger: #ff9b8c;
        --danger-bg: rgba(255, 155, 140, 0.14);
        --shadow: 0 1px 0 rgba(255, 255, 255, 0.02), 0 12px 30px rgba(0, 0, 0, 0.22);
      }

      @media (prefers-color-scheme: dark) {
        :root:not([data-theme="light"]) {
          --bg: #121212;
          --panel: #171717;
          --panel-2: #1d1d1d;
          --text: #f5f5f3;
          --muted: #b8b7b0;
          --line: rgba(255, 255, 255, 0.10);
          --line-strong: rgba(255, 255, 255, 0.16);
          --accent: #f5f5f3;
          --good: #70d6c5;
          --good-bg: rgba(112, 214, 197, 0.12);
        --brand-filter: invert(1) brightness(1.15);
          --caution: #f5c66b;
          --caution-bg: rgba(245, 198, 107, 0.14);
          --danger: #ff9b8c;
          --danger-bg: rgba(255, 155, 140, 0.14);
          --shadow: 0 1px 0 rgba(255, 255, 255, 0.02), 0 12px 30px rgba(0, 0, 0, 0.22);
        }
      }

      * { box-sizing: border-box; }
      html, body {
        margin: 0;
        padding: 0;
        background: transparent;
        color: var(--text);
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      body {
        padding: 12px;
      }
      #app {
        width: 100%;
      }
      .card {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 18px;
        box-shadow: var(--shadow);
        overflow: hidden;
      }
      .card::before {
        content: "";
        display: block;
        height: 4px;
        background: var(--line);
      }
      .card.tone-good::before { background: var(--good); }
      .card.tone-caution::before { background: var(--caution); }
      .card.tone-danger::before { background: var(--danger); }
      .inner {
        padding: 16px;
      }
      .eyebrow {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 10px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .brand-lockup {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
      }
      .brand-mark-wrap {
        width: 30px;
        height: 30px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        background: var(--panel-2);
        border: 1px solid var(--line);
        flex: 0 0 auto;
      }
      .brand-mark {
        width: 20px;
        height: 20px;
        object-fit: contain;
        display: block;
        filter: var(--brand-filter);
      }
      .brand-wordmark {
        height: 14px;
        width: auto;
        display: block;
        filter: var(--brand-filter);
      }
      .host-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 8px;
        border-radius: 999px;
        border: 1px solid var(--line);
        background: var(--panel-2);
      }
      .title {
        margin: 0;
        font-size: 20px;
        line-height: 1.2;
        font-weight: 700;
        letter-spacing: -0.02em;
      }
      .subtitle {
        margin-top: 6px;
        color: var(--muted);
        font-size: 13px;
        line-height: 1.45;
      }
      .summary {
        margin-top: 12px;
        font-size: 14px;
        line-height: 1.55;
      }
      .field-grid,
      .field-list {
        display: grid;
        gap: 10px;
        margin-top: 16px;
      }
      .field-grid {
        grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      }
      .field,
      .item,
      .section {
        border: 1px solid var(--line);
        border-radius: 14px;
        background: var(--panel-2);
      }
      .field {
        padding: 12px;
      }
      .field-label,
      .section-title,
      .item-title {
        font-size: 11px;
        line-height: 1.3;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-weight: 700;
        color: var(--muted);
      }
      .field-value,
      .item-subtitle {
        margin-top: 6px;
        font-size: 14px;
        line-height: 1.45;
      }
      .tone-good .field-value[data-tone="good"],
      .field-value[data-tone="good"] { color: var(--good); }
      .tone-caution .field-value[data-tone="caution"],
      .field-value[data-tone="caution"] { color: var(--caution); }
      .tone-danger .field-value[data-tone="danger"],
      .field-value[data-tone="danger"] { color: var(--danger); }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 16px;
      }
      button.action {
        appearance: none;
        border: 1px solid var(--line-strong);
        background: var(--panel);
        color: var(--text);
        border-radius: 999px;
        padding: 10px 14px;
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      }
      button.action.primary {
        background: var(--accent);
        color: var(--bg);
        border-color: transparent;
      }
      .section,
      .item {
        padding: 14px;
      }
      .section + .section,
      .item + .item {
        margin-top: 12px;
      }
      .item-head {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: baseline;
      }
      .item-title {
        color: var(--text);
        font-size: 14px;
        line-height: 1.35;
        text-transform: none;
        letter-spacing: 0;
      }
      .item-subtitle {
        margin-top: 4px;
        color: var(--muted);
        font-size: 13px;
      }
      .section-title {
        margin-bottom: 10px;
      }
      .empty {
        padding: 18px;
        border: 1px dashed var(--line-strong);
        border-radius: 14px;
        color: var(--muted);
        font-size: 14px;
      }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script>
      const root = document.getElementById('app');

      function escapeHtml(value) {
        return String(value ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      function toneClass(tone) {
        return tone ? 'tone-' + tone : 'tone-neutral';
      }

      function hostLabel(host) {
        if (!host) return 'App';
        if (host === 'chatgpt') return 'ChatGPT';
        return host.charAt(0).toUpperCase() + host.slice(1);
      }

      function getWidgetMeta() {
        return window.openai?.toolResponseMetadata?.['bearingbrain/widget'] ?? null;
      }

      function getUiPayload() {
        return getWidgetMeta()?.ui ?? window.openai?.toolOutput?.ui ?? null;
      }

      function applyTheme() {
        const theme = window.openai?.theme;
        if (theme === 'dark' || theme === 'light') {
          document.documentElement.dataset.theme = theme;
        } else {
          delete document.documentElement.dataset.theme;
        }
      }

      function openHref(href) {
        if (!href) return;
        const bridge = window.openai;
        if (bridge?.openExternal) {
          bridge.openExternal({ href, redirectUrl: false }).catch(() => {
            window.open(href, '_blank', 'noopener,noreferrer');
          });
          return;
        }
        window.open(href, '_blank', 'noopener,noreferrer');
      }

      function renderFields(fields, grid) {
        if (!Array.isArray(fields) || !fields.length) return '';
        const klass = grid ? 'field-grid' : 'field-list';
        return '<div class="' + klass + '">' + fields.map((field) => {
          return '<div class="field">'
            + '<div class="field-label">' + escapeHtml(field.label) + '</div>'
            + '<div class="field-value" data-tone="' + escapeHtml(field.tone || '') + '">' + escapeHtml(field.value) + '</div>'
            + '</div>';
        }).join('') + '</div>';
      }

      function renderSections(sections) {
        if (!Array.isArray(sections) || !sections.length) return '';
        return '<div class="field-list">' + sections.map((section) => {
          return '<section class="section">'
            + '<div class="section-title">' + escapeHtml(section.title) + '</div>'
            + renderFields(section.fields || [], false)
            + '</section>';
        }).join('') + '</div>';
      }

      function renderItems(items) {
        if (!Array.isArray(items) || !items.length) return '';
        return '<div class="field-list">' + items.map((item) => {
          return '<article class="item ' + toneClass(item.tone) + '">'
            + '<div class="item-head"><div>'
            + '<div class="item-title">' + escapeHtml(item.title) + '</div>'
            + (item.subtitle ? '<div class="item-subtitle">' + escapeHtml(item.subtitle) + '</div>' : '')
            + '</div></div>'
            + renderFields(item.fields || [], false)
            + '</article>';
        }).join('') + '</div>';
      }

      function renderActions(ui) {
        const actions = [];
        if (ui.primaryAction?.url) {
          actions.push({ ...ui.primaryAction, primary: true });
        }
        if (Array.isArray(ui.secondaryActions)) {
          ui.secondaryActions.forEach((action) => {
            if (action?.url) actions.push({ ...action, primary: false });
          });
        }
        if (!actions.length) return '';
        return '<div class="actions">' + actions.map((action) => {
          return '<button class="action ' + (action.primary ? 'primary' : '') + '" data-href="' + escapeHtml(action.url) + '">'
            + escapeHtml(action.label)
            + '</button>';
        }).join('') + '</div>';
      }

      function updateOpenInApp(ui) {
        const href = ui?.primaryAction?.url;
        if (!href || !window.openai?.setOpenInAppUrl) return;
        try {
          window.openai.setOpenInAppUrl({ href });
        } catch {}
      }

      function notifyHeight() {
        const bridge = window.openai;
        if (!bridge?.notifyIntrinsicHeight) return;
        requestAnimationFrame(() => {
          try {
            bridge.notifyIntrinsicHeight();
          } catch {}
        });
      }

      function render() {
        applyTheme();
        const ui = getUiPayload();
        const meta = getWidgetMeta();

        if (!ui) {
          root.innerHTML = '<div class="empty">No BearingBrain widget payload was provided for this result.</div>';
          notifyHeight();
          return;
        }

        root.innerHTML = ''
          + '<article class="card ' + toneClass(ui.tone) + '">'
          + '  <div class="inner">'
          + '    <div class="eyebrow">'
          + '      <span class="brand-lockup">'
          + '        <span class="brand-mark-wrap"><img class="brand-mark" src="${CHATGPT_BRAND_MARK_URL}" alt="" /></span>'
          + '        <img class="brand-wordmark" src="${CHATGPT_BRAND_WORDMARK_URL}" alt="BearingBrain" />'
          + '      </span>'
          + '      <span class="host-chip">' + escapeHtml(hostLabel(meta?.host)) + '</span>'
          + '    </div>'
          + '    <h1 class="title">' + escapeHtml(ui.title) + '</h1>'
          + (ui.subtitle ? '<div class="subtitle">' + escapeHtml(ui.subtitle) + '</div>' : '')
          + (ui.summary ? '<div class="summary">' + escapeHtml(ui.summary) + '</div>' : '')
          + renderActions(ui)
          + renderFields(ui.fields || [], true)
          + renderSections(ui.sections || [])
          + renderItems(ui.items || [])
          + '  </div>'
          + '</article>';

        root.querySelectorAll('[data-href]').forEach((button) => {
          button.addEventListener('click', () => openHref(button.getAttribute('data-href')));
        });

        updateOpenInApp(ui);
        notifyHeight();
      }

      render();
      window.addEventListener('openai:set_globals', render, { passive: true });
      window.addEventListener('resize', notifyHeight, { passive: true });
    </script>
  </body>
</html>`;
}
