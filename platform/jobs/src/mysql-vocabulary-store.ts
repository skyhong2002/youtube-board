import { assertVocabularyBudget } from './vocabulary-budget.js';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { aggregateTerms, SOURCE, validateWindow, type ArticlePage, type SourceArticle, type SyncRun, type VocabularySnapshot, type VocabularyStore, type Window } from './vocabulary.js';
export class MysqlVocabularyStore implements VocabularyStore {
  constructor(private readonly db: Connection) {}
  private async run(id: string, lock = false): Promise<SyncRun> {
    if (id.startsWith('tag-')) throw new Error('Invalid vocabulary run id');
    const [rows] = await this.db.query<RowDataPacket[]>(`SELECT * FROM ts_vocabulary_runs WHERE id = ?${lock ? ' FOR UPDATE' : ''}`, [id]);
    const row = rows[0];
    if (!row) throw new Error('Unknown vocabulary run');
    return { id: row.id, window: { since: row.window_since, until: row.window_until }, cursor: row.checkpoint_cursor, pages: row.pages, status: row.status };
  }
  async begin(id: string, window: Window): Promise<SyncRun> {
    validateWindow(window);
    if (id.startsWith('tag-') || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new Error('Invalid vocabulary run id');
    await this.db.execute('INSERT INTO ts_vocabulary_runs (id, window_since, window_until) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE id = id', [id, window.since, window.until]);
    const run = await this.run(id);
    if (run.window.since !== window.since || run.window.until !== window.until) throw new Error('Run id is already bound to a different window');
    return run;
  }
  async stage(id: string, expectedCursor: string | null, page: ArticlePage): Promise<SyncRun> {
    await this.db.beginTransaction();
    try {
      const run = await this.run(id, true);
      if (run.status !== 'scanning' || run.cursor !== expectedCursor) throw new Error('Stale vocabulary checkpoint');
      const [counts] = await this.db.query<RowDataPacket[]>('SELECT COUNT(*) AS total FROM ts_vocabulary_stage WHERE run_id = ?', [id]);
      if (Number(counts[0]?.total) + page.articles.length > 50000) throw new Error('Vocabulary article cap reached; choose a smaller observation window');
      for (const article of page.articles) await this.db.execute('INSERT INTO ts_vocabulary_stage (run_id, article_id, payload) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE payload = VALUES(payload)', [id, article.id, JSON.stringify(article)]);
      await this.db.execute('UPDATE ts_vocabulary_runs SET checkpoint_cursor = ?, pages = pages + 1, status = ? WHERE id = ?', [page.nextCursor, page.nextCursor ? 'scanning' : 'ready', id]);
      await this.db.commit();
      return this.run(id);
    } catch (error) { await this.db.rollback().catch(() => undefined); throw error; }
  }
  async publish(id: string): Promise<VocabularySnapshot> {
    await this.db.beginTransaction();
    try {
      const run = await this.run(id, true);
      if (run.status === 'published') {
        const [rows] = await this.db.query<RowDataPacket[]>('SELECT snapshot FROM ts_vocabulary_runs WHERE id = ?', [id]);
        await this.db.commit();
        return JSON.parse(rows[0]!.snapshot) as VocabularySnapshot;
      }
      if (run.status !== 'ready') throw new Error('Incomplete vocabulary cannot be published');
      const [rows] = await this.db.query<RowDataPacket[]>('SELECT payload FROM ts_vocabulary_stage WHERE run_id = ?', [id]);
      const snapshot: VocabularySnapshot = { id, source: SOURCE, window: run.window, publishedAt: new Date().toISOString(), coverage: 'observed-article-window', upstreamSnapshotConsistent: false, terms: aggregateTerms(rows.map(row => JSON.parse(row.payload) as SourceArticle)) };
      assertVocabularyBudget(snapshot.terms);
      // Do not let a resumed older window displace a newer completed observation.
      const [current] = await this.db.query<RowDataPacket[]>('SELECT r.window_until, r.snapshot FROM ts_vocabulary_current c JOIN ts_vocabulary_runs r ON r.id = c.run_id WHERE c.source = ? FOR UPDATE', [SOURCE]);
      const currentCoverage = current[0] ? JSON.parse(current[0].snapshot)?.coverage : null;
      snapshot.becameCurrent = currentCoverage !== 'all-current-indexed-article-tags' && (!current[0] || Date.parse(run.window.until) >= Date.parse(current[0].window_until));
      if (snapshot.terms.length > 50000 || Buffer.byteLength(JSON.stringify(snapshot)) > 8000000) throw new Error('Vocabulary snapshot exceeds publication cap');
      await this.db.execute('UPDATE ts_vocabulary_runs SET status = ?, snapshot = ?, published_at = CURRENT_TIMESTAMP(3) WHERE id = ?', ['published', JSON.stringify(snapshot), id]);
      if (snapshot.becameCurrent) await this.db.execute('INSERT INTO ts_vocabulary_current (source, run_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE run_id = VALUES(run_id)', [SOURCE, id]);
      await this.db.commit();
      return snapshot;
    } catch (error) { await this.db.rollback().catch(() => undefined); throw error; }
  }
}
