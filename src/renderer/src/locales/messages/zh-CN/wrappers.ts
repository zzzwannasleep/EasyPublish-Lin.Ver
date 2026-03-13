const wrappers = {
  'accounts.hero.eyebrow': '账号',
  'accounts.hero.title': '查看站点会话和登录状态。',
  'accounts.hero.summary':
    '账号校验、验证码处理和 Cookie 存储目前仍走旧 BT 账号服务。这里先改的是外围工作台，不改底层行为。',
  'accounts.hero.chip': '凭据存储仍在兼容层',
  'accounts.panel.eyebrow': '站点会话',
  'accounts.panel.title': '当前账号控制面板',
  'accounts.panel.description': '在新工作台里直接刷新会话、触发登录并查看账号状态。',
  'guide.hero.eyebrow': '说明',
  'guide.hero.title': '查看当前发布流程的参考说明。',
  'guide.hero.summary':
    '界面已经在重构，但底层操作步骤仍沿用现有工作流。这份说明会继续保留，直到新总览页完全接管引导内容。',
  'guide.panel.eyebrow': '参考',
  'guide.panel.title': '旧版快速开始',
  'guide.panel.description': '在新总览完全接管前，这里仍作为过渡期说明入口。',
  'tools.hero.eyebrow': '工具',
  'tools.hero.title': '继续保留旧修改工作流入口。',
  'tools.hero.summary':
    '这个工具当前仍处于兼容模式。新工作台会继续保留它，直到后续阶段决定是否独立重做或彻底下线。',
  'tools.panel.eyebrow': '兼容层',
  'tools.panel.title': '旧修改模块',
  'tools.panel.description': '这一阶段不改它的业务逻辑，只先保留可访问入口。',
} as const

export default wrappers
