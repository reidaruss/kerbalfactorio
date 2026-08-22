// PS-53. `--import ./tools/ts-run.mjs` installs `ts-hooks.mjs`.
//
// Two files rather than one because node runs module hooks on their own
// thread: `register` takes the PATH of the hook module, so the hook cannot be
// the file that registers it.
import { register } from 'node:module';

register('./ts-hooks.mjs', import.meta.url);
