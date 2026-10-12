/** Process-local cooperative cancellation; no job can clear shutdown once requested. */
const controller = new AbortController();
export function workflowShutdownSignal(): AbortSignal { return controller.signal; }
export function requestWorkflowShutdown(): void { controller.abort(new Error('Worker is shutting down; resume through a new scheduled run')); }
