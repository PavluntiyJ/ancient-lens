// Called by the Rust integration test with synthetic values serialized by the real store.
import { stateResultSchema, ownUpdateSchema } from '../src/shared/state-schema.ts';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const samples = JSON.parse(input);
for (const sample of samples) {
  stateResultSchema.parse(sample.state);
  ownUpdateSchema.parse(sample.own);
}
console.log(`Validated ${samples.length} Rust state/event samples.`);
