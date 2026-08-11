use std::sync::Mutex;
use crate::document::{apply_doc_ops, compute_doc_ops, Document, DocOp};

pub struct AppState {
    pub document: Mutex<Document>,
    /// History of change batches. Each entry is the set of DocOps that transformed
    /// the document from state N to state N+1. Storing deltas instead of full
    /// snapshots keeps memory usage low for novel-length documents.
    pub history: Mutex<Vec<Vec<DocOp>>>,
    pub history_index: Mutex<usize>,
    pub max_history: usize,
    pub is_modified: Mutex<bool>,
    pub last_path: Mutex<Option<String>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            document: Mutex::new(Document::default()),
            history: Mutex::new(Vec::new()),
            history_index: Mutex::new(0),
            max_history: 30,
            is_modified: Mutex::default(),
            last_path: Mutex::default(),
        }
    }

    /// Record the delta between `old` and the current document state as a new
    /// history entry. If the user had undone and then mutates, discard the
    /// redo branch first.
    pub fn push_history_delta(&self, old: &Document) {
        let current = self.document.lock().unwrap().clone();
        let ops = compute_doc_ops(old, &current);
        if ops.is_empty() {
            return;
        }

        let mut history = self.history.lock().unwrap();
        let mut index = self.history_index.lock().unwrap();

        if *index < history.len() {
            history.truncate(*index);
        }

        history.push(ops);
        *index += 1;

        while history.len() > self.max_history {
            history.remove(0);
            *index = index.saturating_sub(1);
        }
    }

    /// Reset history to an empty baseline, used when opening a file.
    pub fn reset_history(&self) {
        let mut history = self.history.lock().unwrap();
        let mut index = self.history_index.lock().unwrap();
        history.clear();
        *index = 0;
    }

    /// Undo the most recent change batch by inverting and applying its
    /// operations in reverse order. Returns true if an undo occurred.
    pub fn undo(&self) -> Result<bool, String> {
        let (ops, new_index) = {
            let index = self.history_index.lock().unwrap();
            let history = self.history.lock().unwrap();
            if *index == 0 || history.is_empty() {
                return Ok(false);
            }
            let ops = history[*index - 1].clone();
            (ops, *index - 1)
        };

        let mut inverted: Vec<DocOp> = ops.iter().map(|op| op.invert()).collect();
        inverted.reverse();

        let mut doc = self.document.lock().map_err(|e| e.to_string())?;
        apply_doc_ops(&mut *doc, &inverted)?;

        let mut index = self.history_index.lock().unwrap();
        *index = new_index;
        Ok(true)
    }

    /// Redo the next change batch by applying it forward. Returns true if a redo
    /// occurred.
    pub fn redo(&self) -> Result<bool, String> {
        let ops = {
            let index = self.history_index.lock().unwrap();
            let history = self.history.lock().unwrap();
            if *index >= history.len() {
                return Ok(false);
            }
            history[*index].clone()
        };

        let mut doc = self.document.lock().map_err(|e| e.to_string())?;
        apply_doc_ops(&mut *doc, &ops)?;

        let mut index = self.history_index.lock().unwrap();
        *index += 1;
        Ok(true)
    }
}
