import common from './common'
import navigation from './navigation'
import dashboard from './dashboard'
import projects from './projects'
import workflow from './workflow'
import wrappers from './wrappers'
import logs from './logs'
import sites from './sites'

const zhCN = {
  ...common,
  ...navigation,
  ...dashboard,
  ...projects,
  ...workflow,
  ...wrappers,
  ...logs,
  ...sites,
} as const

export default zhCN
