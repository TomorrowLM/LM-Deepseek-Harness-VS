// dsh-vscode-reference-sync client bundle (ModuleLoader format)
// Receives a batch from the VS Code webview and appends native DSH reference chips
// to the current session draft. Each insertion uses a fresh draft revision.

window.__ModuleLoader__.load({ id: 'dsh-vscode-reference-sync', factory: (require) => {
  var module = { exports: {} }
  var exports = module.exports
  var React = require('react')

  var HOST_ID = 'dsh-vscode-host'
  var PLUGIN_ID = 'dsh-vscode-reference-sync'
  var SOURCE_NAME = 'dsh-vscode-reference-sync'
  var handledRequests = Object.create(null)
  var handledRequestOrder = []

  function basenameOf(path) {
    var i = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
    return i === -1 ? path : path.slice(i + 1)
  }

  function lineSuffix(startLine, endLine) {
    return ':' + startLine + (endLine > startLine ? '-' + endLine : '')
  }

  // InputState.draft uses clipboard-text coordinates, where a reference chip
  // expands to its serialized text. TokenSpan uses detect coordinates, where
  // each chip is one U+FFFC, so collapse existing chips before appending.
  function detectDraftEnd(state) {
    if (!state || typeof state.draft !== 'string' || !Array.isArray(state.occurrences)) return null

    var collapsedLength = 0
    var previousEnd = 0
    for (var i = 0; i < state.occurrences.length; i++) {
      var occurrence = state.occurrences[i]
      var offset = occurrence && occurrence.offset
      var length = occurrence && occurrence.length
      var clipboardText = occurrence && occurrence.clipboardText
      if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < previousEnd || length < 1 ||
          offset + length > state.draft.length || typeof clipboardText !== 'string' ||
          clipboardText.length !== length || state.draft.slice(offset, offset + length) !== clipboardText) {
        return null
      }
      collapsedLength += length - 1
      previousEnd = offset + length
    }

    var detectEnd = state.draft.length - collapsedLength
    return detectEnd >= 0 ? detectEnd : null
  }

  function postAck(requestId, status, inserted, total, failedIndex) {
    try {
      window.parent.postMessage({
        source: PLUGIN_ID,
        type: 'insert-references-ack',
        requestId: requestId,
        status: status,
        inserted: inserted,
        total: total,
        failedIndex: failedIndex
      }, '*')
    } catch (e) { /* the parent webview may already be closing */ }
  }

  function insertReferences(ctx, sessionId, requestId, references) {
    var inserted = 0
    try {
      var actx = ctx.sessions.scope(sessionId)
      var conversation = actx.get('conversation')
      if (!conversation || !conversation.input || typeof conversation.input.for !== 'function') {
        postAck(requestId, 'error', 0, references.length, 0)
        return
      }

      var input = conversation.input.for(actx)
      if (!input || typeof input.insertReference !== 'function' || !input.state) {
        postAck(requestId, 'error', 0, references.length, 0)
        return
      }

      for (var i = 0; i < references.length; i++) {
        var item = references[i]
        var filePath = typeof item.filePath === 'string' ? item.filePath.trim() : ''
        var startLine = Number(item.startLine)
        var endLine = Number(item.endLine)
        if (!filePath || !Number.isInteger(startLine) || !Number.isInteger(endLine) ||
            startLine < 1 || endLine < startLine) {
          postAck(requestId, 'partial', inserted, references.length, i)
          return
        }

        var state = input.state.getSnapshot()
        if (!state || typeof state.draft !== 'string' || !Number.isInteger(state.draftRev)) {
          postAck(requestId, 'partial', inserted, references.length, i)
          return
        }

        var position = detectDraftEnd(state)
        if (position === null) {
          postAck(requestId, 'partial', inserted, references.length, i)
          return
        }

        var suffix = lineSuffix(startLine, endLine)
        var ref = filePath + suffix
        var label = basenameOf(filePath) + suffix
        var accepted = input.insertReference({
          source: SOURCE_NAME,
          ref: ref,
          label: label,
          clipboardText: ref
        }, {
          start: position,
          end: position,
          draftRev: state.draftRev
        })

        if (accepted !== true) {
          postAck(requestId, 'partial', inserted, references.length, i)
          return
        }
        inserted += 1
      }

      postAck(requestId, 'inserted', inserted, references.length, -1)
    } catch (e) {
      postAck(requestId, inserted > 0 ? 'partial' : 'error', inserted, references.length, inserted)
      console.error('[dsh-vscode-reference-sync] insertion failed:', e)
    }
  }

  function ReferenceSync(props) {
    React.useEffect(function () {
      function onMessage(event) {
        if (event.source !== window.parent) return
        var data = event.data
        if (!data || data.source !== HOST_ID || data.type !== 'insert-references') return
        if (typeof data.requestId !== 'string' || data.requestId.length === 0 ||
            !Array.isArray(data.references) || data.references.length === 0) return
        if (handledRequests[data.requestId]) return
        handledRequests[data.requestId] = true
        handledRequestOrder.push(data.requestId)
        if (handledRequestOrder.length > 64) {
          delete handledRequests[handledRequestOrder.shift()]
        }
        insertReferences(props.ctx, props.sessionId, data.requestId, data.references)
      }

      window.addEventListener('message', onMessage)
      return function () { window.removeEventListener('message', onMessage) }
    }, [props.ctx, props.sessionId])

    return null
  }

  function apply(ctx) {
    ctx.effect(function () {
      return ctx.inputTriggers.registerSource({
        trigger: '@',
        name: SOURCE_NAME,
        candidates: async function () { return [] },
        onPick: function () { return undefined },
        codec: {
          clipboardText: function (ref) { return ref },
          serialize: async function (ref) { return ref }
        }
      })
    })

    ctx.slots.inject('conversation.input.left', function () {
      return ctx.slots.register({
        name: 'conversation.input.left',
        id: 'dsh-vscode-reference-sync',
        order: 1,
        inject: function (sessionId) {
          return { ctx: ctx, sessionId: sessionId }
        }
      }, ReferenceSync)
    })
  }

  exports.apply = apply
  exports.inject = ['slots', 'inputTriggers', 'sessions']
  return module.exports
} })
