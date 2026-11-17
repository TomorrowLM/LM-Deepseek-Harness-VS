// dsh-vscode-reference-sync host half: no-op.
// Reference insertion runs in the DSH client because only its session-scoped input
// facade can create native reference chips in the active conversation draft.
export const name = 'dsh-vscode-reference-sync'

export const inject = []

export function apply(_ctx) {}
