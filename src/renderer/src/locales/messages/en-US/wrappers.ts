const wrappers = {
  'accounts.hero.eyebrow': 'Accounts',
  'accounts.hero.title': 'Inspect site sessions and login state.',
  'accounts.hero.summary':
    'Account validation, captcha handling, and cookie storage still run through the legacy BT account service. This page changes the shell, not the underlying behavior.',
  'accounts.hero.chip': 'Credential storage remains on the compatibility layer',
  'accounts.panel.eyebrow': 'Site Sessions',
  'accounts.panel.title': 'Current Account Control Panel',
  'accounts.panel.description': 'Refresh sessions, trigger login flows, and inspect account status from the new workspace.',
  'guide.hero.eyebrow': 'Guide',
  'guide.hero.title': 'Reference the current publishing workflow.',
  'guide.hero.summary':
    'The UI is being refactored, but the operational flow still follows the existing workflow. This guide remains available until the new dashboard fully takes over onboarding.',
  'guide.panel.eyebrow': 'Reference',
  'guide.panel.title': 'Legacy Quick Start',
  'guide.panel.description': 'This stays available as a transitional entry point until the new dashboard takes over completely.',
  'tools.hero.eyebrow': 'Tools',
  'tools.hero.title': 'Keep the legacy modify workflow reachable.',
  'tools.hero.summary':
    'This tool still runs in compatibility mode. The new shell keeps it reachable until a later phase decides whether to rebuild or retire it.',
  'tools.panel.eyebrow': 'Compatibility',
  'tools.panel.title': 'Legacy Modify Module',
  'tools.panel.description': 'This phase does not change its business logic yet; it only keeps the entry point available.',
} as const

export default wrappers
