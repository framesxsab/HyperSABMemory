import { Command } from 'commander';
import picocolors from 'picocolors';
import { SupermemoryEngine } from '../memory/supermemory.js';

export function registerMemoryCommands(program: Command): void {
  program
    .command('remember')
    .description('Save a memory fact from the terminal (same store the MCP tools use)')
    .argument('<content>', 'Fact or decision to remember')
    .option('-c, --category <category>', 'architecture | decision | bug | symbol | general', 'general')
    .option('-t, --tag <tags...>', 'Searchable tags')
    .action((content: string, options: { category: string; tag?: string[] }) => {
      try {
        const engine = new SupermemoryEngine(process.cwd());
        const record = engine.remember(
          options.category as 'architecture' | 'decision' | 'bug' | 'symbol' | 'general',
          content,
          options.tag ?? []
        );
        console.log(picocolors.green(`✔ Saved memory [${record.id}]: ${record.content}`));
      } catch (err) {
        console.log(picocolors.red(`✖ ${(err as Error).message}`));
        process.exitCode = 1;
      }
    });

  program
    .command('list')
    .alias('recall')
    .description('List active memories (ranked by hybrid BM25 search when --query is given)')
    .option('-q, --query <query>', 'Rank by this search term instead of listing all')
    .option('-l, --limit <count>', 'Max results', '10')
    .action((options: { query?: string; limit: string }) => {
      const engine = new SupermemoryEngine(process.cwd());
      const limit = Math.min(Math.max(1, parseInt(options.limit, 10) || 10), 100);
      const records = options.query
        ? engine.query(options.query, limit)
        : engine.getActive().slice(0, limit);
      if (records.length === 0) {
        console.log(picocolors.yellow('ℹ No matching memories.'));
        return;
      }
      for (const record of records) {
        console.log(`  ${picocolors.gray(record.id)}  [${record.category}] ${record.content}`);
      }
    });

  program
    .command('forget')
    .description('Invalidate a memory by id (it drops out of the Context Block)')
    .argument('<id>', 'Memory record id')
    .action((id: string) => {
      const engine = new SupermemoryEngine(process.cwd());
      const forgotten = engine.forget(id);
      if (forgotten) {
        console.log(picocolors.green(`✔ Forgot memory [${forgotten.id}]`));
      } else {
        console.log(picocolors.red(`✖ No memory found for id ${id}`));
        process.exitCode = 1;
      }
    });
}
