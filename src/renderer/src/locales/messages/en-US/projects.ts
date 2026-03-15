const projects = {
  'projects.hero.eyebrow': 'Projects',
  'projects.hero.title': 'Inspect and resume local project state.',
  'projects.hero.summary':
    'The list below already loads through the new project bridge API, while edit, review, and publish stages still reuse the existing publisher.',
  'projects.hero.chip': 'Project list connected',
  'projects.panel.eyebrow': 'Project List',
  'projects.panel.title': 'Local Release Workspace',
  'projects.panel.description': 'Open a project, continue publishing, or inspect recorded links.',
  'projectCreate.hero.eyebrow': 'Projects',
  'projectCreate.hero.title': 'Create a new publishing project.',
  'projectCreate.hero.summary':
    'Choose the project mode first, then continue into the matching create form and publishing workflow.',
  'projectCreate.hero.chip': 'Project model connected',
  'projectCreate.panel.eyebrow': 'Project Setup',
  'projectCreate.panel.title': 'Initialize Release Workspace',
  'projectCreate.panel.description':
    'Choose series or feature/movie mode first, then continue into the matching create form.',
  'create.mode.dialog.title': 'Choose Project Mode',
  'create.mode.dialog.description':
    'Decide whether this is a series release or a feature/movie release before selecting the detailed flow.',
  'create.mode.dialog.open': 'Choose Mode',
  'create.mode.current': 'Current Mode',
  'create.mode.unselected': 'Not selected yet',
  'create.mode.back': 'Choose another mode',
  'create.mode.episode.label': 'Series',
  'create.mode.episode.description':
    'Best for ongoing episodic releases with explicit target-site tracking and missing-publish reminders.',
  'create.mode.episode.action': 'Open series form',
  'create.mode.feature.label': 'Feature / Movie',
  'create.mode.feature.description':
    'Keep the existing quick, file-import, and template-based creation flows for full releases.',
  'create.mode.feature.action': 'Open feature form',
  'create.form.name.label': 'Project Name',
  'create.form.name.placeholder': 'Leave blank to use a timestamp-based folder name',
  'create.form.directory.label': 'Working Directory',
  'create.form.directory.placeholder': 'Leave blank to use the app-data project folder',
  'create.form.source.label': 'Content Source',
  'create.form.submit': 'Create Project',
  'create.form.source.quick.label': 'Quick Publish',
  'create.form.source.quick.description': 'Start from the current guided workflow.',
  'create.form.source.file.label': 'From Files',
  'create.form.source.file.description':
    'Seed the project from existing Markdown, HTML, and BBCode files.',
  'create.form.source.template.label': 'From Template',
  'create.form.source.template.description':
    'Use template fields and generate content inside the project.',
  'create.validation.sourceKind': 'Choose a project source mode.',
  'create.validation.completeRequired': 'Complete the required fields before creating the project.',
  'create.error.directoryMissing': 'The selected working directory does not exist.',
  'create.success.created': 'Project created. Opening the editor workspace.',
  'create.feature.actionsText':
    'Feature and movie projects keep the existing quick, file, and template creation paths.',
  'create.episode.title': 'Create Series Workspace',
  'create.episode.description':
    'Create the series project shell first, then enter the series workspace and open the current release draft from there.',
  'create.episode.alert':
    'Series-mode projects land in the series workspace first, then expand the current release draft from there.',
  'create.episode.nameHelp':
    'A series-based naming pattern makes later catch-up publishing much easier to scan.',
  'create.episode.directoryHelp':
    'Use a dedicated working folder for series projects or keep the default app-managed path.',
  'create.episode.nextTitle': 'Next Step',
  'create.episode.nextDescription':
    'After creation, the series workspace opens so you can review targets and expand the current release draft.',
  'create.episode.success': 'Series project created. Opening the workspace.',
  'taskList.filter.showPublished': 'Show completed projects',
  'taskList.filter.mode.label': 'Project Mode',
  'taskList.filter.mode.all': 'All modes',
  'taskList.filter.missingTargets': 'Only projects with pending targets',
  'taskList.actions.refresh': 'Refresh',
  'taskList.actions.open': 'Open',
  'taskList.actions.openList': 'View all projects',
  'taskList.actions.openFolder': 'Open Folder',
  'taskList.actions.delete': 'Delete',
  'taskList.actions.continue': 'Continue',
  'taskList.actions.copy': 'Copy',
  'taskList.summary.total': 'All Projects',
  'taskList.summary.active': 'In Progress',
  'taskList.summary.published': 'Published',
  'taskList.summary.visible': 'Visible Now',
  'taskList.card.links': 'Recorded Links',
  'taskList.empty.title': 'No projects to show',
  'taskList.empty.description':
    'Create a project first, then continue editing, review, and publishing here.',
  'taskList.columns.folder': 'Folder',
  'taskList.columns.project': 'Project',
  'taskList.columns.source': 'Source',
  'taskList.columns.stage': 'Stage',
  'taskList.columns.status': 'Status',
  'taskList.columns.updated': 'Updated',
  'taskList.details.workingDirectory': 'Working Directory',
  'taskList.details.noLinks': 'No publish links have been recorded for this project yet.',
  'taskList.status.published': 'Published',
  'taskList.success.removed': 'Removed project "{name}".',
  'taskList.success.copied': 'Copied to clipboard.'
} as const

export default projects
