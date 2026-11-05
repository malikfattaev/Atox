/** Группы значков папок проектов — в том порядке, в каком их показывает выбор значка. */
export const PROJECT_ICON_GROUPS = [
  { id: 'general', name: 'General' },
  { id: 'development', name: 'Development' },
  { id: 'devices', name: 'Web & Devices' },
  { id: 'infrastructure', name: 'Data & Infrastructure' },
  { id: 'design', name: 'Design & Media' },
  { id: 'business', name: 'Business & Docs' },
  { id: 'science', name: 'Science & Nature' },
  { id: 'fun', name: 'Fun' }
] as const

export type ProjectIconGroup = (typeof PROJECT_ICON_GROUPS)[number]['id']

/**
 * Значки папок проектов. `id` сохраняется в файле проектов, поэтому не меняется, даже если
 * меняется сам рисунок; `keywords` — дополнительные слова для поиска.
 */
export const PROJECT_ICONS = [
  { id: 'folder-code', name: 'Code Folder', group: 'general', keywords: 'project source' },
  { id: 'folder-git', name: 'Git Folder', group: 'general', keywords: 'repository repo' },
  { id: 'folder-heart', name: 'Favorite Folder', group: 'general', keywords: 'love' },
  { id: 'folder-kanban', name: 'Board Folder', group: 'general', keywords: 'tasks planning' },
  { id: 'folder-lock', name: 'Private Folder', group: 'general', keywords: 'secure locked' },
  { id: 'archive', name: 'Archive', group: 'general', keywords: 'old storage' },
  { id: 'package', name: 'Package', group: 'general', keywords: 'box npm library' },
  { id: 'briefcase', name: 'Work', group: 'general', keywords: 'job briefcase' },
  { id: 'house', name: 'Home', group: 'general', keywords: 'personal house' },
  { id: 'star', name: 'Star', group: 'general', keywords: 'favorite' },
  { id: 'heart', name: 'Heart', group: 'general', keywords: 'love favorite' },
  { id: 'layers', name: 'Layers', group: 'general', keywords: 'stack' },

  { id: 'code', name: 'Code', group: 'development', keywords: 'html xml tags' },
  { id: 'braces', name: 'Braces', group: 'development', keywords: 'json javascript' },
  { id: 'terminal', name: 'Terminal', group: 'development', keywords: 'shell cli console' },
  { id: 'git-branch', name: 'Branch', group: 'development', keywords: 'git version' },
  { id: 'git-fork', name: 'Fork', group: 'development', keywords: 'git open source' },
  { id: 'bug', name: 'Bug', group: 'development', keywords: 'debug issue' },
  { id: 'blocks', name: 'Blocks', group: 'development', keywords: 'modules' },
  { id: 'puzzle', name: 'Plugin', group: 'development', keywords: 'extension puzzle' },
  { id: 'component', name: 'Component', group: 'development', keywords: 'ui library' },
  { id: 'variable', name: 'Function', group: 'development', keywords: 'variable math' },
  { id: 'wrench', name: 'Tools', group: 'development', keywords: 'wrench fix utility' },
  { id: 'bot', name: 'Bot', group: 'development', keywords: 'ai agent robot' },
  { id: 'webhook', name: 'Webhook', group: 'development', keywords: 'api integration' },

  { id: 'globe', name: 'Website', group: 'devices', keywords: 'web internet globe' },
  { id: 'app-window', name: 'App', group: 'devices', keywords: 'window desktop' },
  { id: 'monitor', name: 'Desktop', group: 'devices', keywords: 'monitor screen' },
  { id: 'laptop', name: 'Laptop', group: 'devices', keywords: 'computer mac' },
  { id: 'smartphone', name: 'Mobile', group: 'devices', keywords: 'phone ios android' },
  { id: 'tablet', name: 'Tablet', group: 'devices', keywords: 'ipad' },
  { id: 'watch', name: 'Watch', group: 'devices', keywords: 'wearable' },
  { id: 'gamepad', name: 'Game', group: 'devices', keywords: 'gaming controller' },
  { id: 'keyboard', name: 'Keyboard', group: 'devices', keywords: 'input' },
  { id: 'cpu', name: 'Chip', group: 'devices', keywords: 'cpu processor' },
  { id: 'circuit-board', name: 'Hardware', group: 'devices', keywords: 'electronics embedded' },
  { id: 'router', name: 'Router', group: 'devices', keywords: 'network iot' },

  { id: 'database', name: 'Database', group: 'infrastructure', keywords: 'sql storage' },
  { id: 'server', name: 'Server', group: 'infrastructure', keywords: 'backend' },
  { id: 'cloud', name: 'Cloud', group: 'infrastructure', keywords: 'hosting' },
  { id: 'network', name: 'Network', group: 'infrastructure', keywords: 'topology' },
  { id: 'container', name: 'Container', group: 'infrastructure', keywords: 'docker' },
  { id: 'boxes', name: 'Services', group: 'infrastructure', keywords: 'microservices boxes' },
  { id: 'workflow', name: 'Workflow', group: 'infrastructure', keywords: 'pipeline ci automation' },
  { id: 'table', name: 'Table', group: 'infrastructure', keywords: 'spreadsheet data' },
  { id: 'activity', name: 'Monitoring', group: 'infrastructure', keywords: 'metrics pulse' },
  { id: 'shield', name: 'Security', group: 'infrastructure', keywords: 'shield protect' },
  { id: 'key', name: 'Keys', group: 'infrastructure', keywords: 'auth secrets' },

  { id: 'palette', name: 'Palette', group: 'design', keywords: 'colors' },
  { id: 'brush', name: 'Brush', group: 'design', keywords: 'paint art' },
  { id: 'pen-tool', name: 'Vector', group: 'design', keywords: 'pen illustration' },
  { id: 'shapes', name: 'Shapes', group: 'design', keywords: 'geometry' },
  { id: 'type', name: 'Typography', group: 'design', keywords: 'font text' },
  { id: 'layout', name: 'Layout', group: 'design', keywords: 'dashboard ui' },
  { id: 'image', name: 'Image', group: 'design', keywords: 'picture' },
  { id: 'camera', name: 'Photo', group: 'design', keywords: 'camera' },
  { id: 'clapperboard', name: 'Film', group: 'design', keywords: 'movie video' },
  { id: 'music', name: 'Music', group: 'design', keywords: 'audio song' },
  { id: 'mic', name: 'Podcast', group: 'design', keywords: 'microphone voice' },
  { id: 'headphones', name: 'Audio', group: 'design', keywords: 'headphones sound' },

  { id: 'shopping-cart', name: 'Shop', group: 'business', keywords: 'store ecommerce cart' },
  { id: 'wallet', name: 'Finance', group: 'business', keywords: 'money wallet' },
  { id: 'chart-line', name: 'Analytics', group: 'business', keywords: 'growth stats' },
  { id: 'chart-pie', name: 'Report', group: 'business', keywords: 'stats chart' },
  { id: 'presentation', name: 'Presentation', group: 'business', keywords: 'slides pitch' },
  { id: 'megaphone', name: 'Marketing', group: 'business', keywords: 'announce' },
  { id: 'users', name: 'Team', group: 'business', keywords: 'people users' },
  { id: 'building', name: 'Company', group: 'business', keywords: 'office building' },
  { id: 'file-text', name: 'Document', group: 'business', keywords: 'docs text' },
  { id: 'book-open', name: 'Docs', group: 'business', keywords: 'book guide read' },
  { id: 'notebook-pen', name: 'Notes', group: 'business', keywords: 'journal notebook' },
  { id: 'list-todo', name: 'Tasks', group: 'business', keywords: 'todo checklist' },
  { id: 'calendar', name: 'Calendar', group: 'business', keywords: 'schedule events' },

  { id: 'flask', name: 'Lab', group: 'science', keywords: 'experiment chemistry flask' },
  { id: 'atom', name: 'Physics', group: 'science', keywords: 'atom react' },
  { id: 'microscope', name: 'Research', group: 'science', keywords: 'microscope' },
  { id: 'dna', name: 'Biology', group: 'science', keywords: 'dna genetics' },
  { id: 'brain', name: 'Machine Learning', group: 'science', keywords: 'ai ml neural brain' },
  { id: 'calculator', name: 'Math', group: 'science', keywords: 'calculator' },
  { id: 'telescope', name: 'Astronomy', group: 'science', keywords: 'telescope space' },
  { id: 'rocket', name: 'Rocket', group: 'science', keywords: 'launch startup space' },
  { id: 'leaf', name: 'Eco', group: 'science', keywords: 'leaf green nature' },
  { id: 'sprout', name: 'Growth', group: 'science', keywords: 'sprout seed new' },
  { id: 'earth', name: 'Earth', group: 'science', keywords: 'planet world' },
  { id: 'moon', name: 'Moon', group: 'science', keywords: 'night dark' },

  { id: 'sparkles', name: 'Magic', group: 'fun', keywords: 'sparkles ai new' },
  { id: 'zap', name: 'Fast', group: 'fun', keywords: 'lightning zap' },
  { id: 'flame', name: 'Hot', group: 'fun', keywords: 'fire flame' },
  { id: 'trophy', name: 'Trophy', group: 'fun', keywords: 'win award' },
  { id: 'lightbulb', name: 'Idea', group: 'fun', keywords: 'lightbulb' },
  { id: 'target', name: 'Goal', group: 'fun', keywords: 'target aim' },
  { id: 'coffee', name: 'Coffee', group: 'fun', keywords: 'cup java' },
  { id: 'gift', name: 'Gift', group: 'fun', keywords: 'present' },
  { id: 'party-popper', name: 'Party', group: 'fun', keywords: 'celebrate' },
  { id: 'ghost', name: 'Ghost', group: 'fun', keywords: 'spooky' },
  { id: 'cat', name: 'Cat', group: 'fun', keywords: 'pet animal' },
  { id: 'dog', name: 'Dog', group: 'fun', keywords: 'pet animal' },
  { id: 'paw-print', name: 'Paw', group: 'fun', keywords: 'pet animal' },
  { id: 'dice', name: 'Dice', group: 'fun', keywords: 'random game' },
  { id: 'plane', name: 'Travel', group: 'fun', keywords: 'plane flight trip' }
] as const satisfies readonly {
  id: string
  name: string
  group: ProjectIconGroup
  keywords: string
}[]

export type ProjectIcon = (typeof PROJECT_ICONS)[number]['id']

export function isProjectIcon(value: unknown): value is ProjectIcon {
  return PROJECT_ICONS.some(({ id }) => id === value)
}
