# Vendored KataGo browser engine

Files copied from [web-katrain](https://github.com/Sir-Teo/web-katrain) (MIT, see `LICENSE`),
commit `8dd813aeb565cbdad5215dc75204fc40fd519c50`:

- `engine/katago/`: binModelParser, loadModelV8, modelV8, evalV8, featuresV7Fast, historyV7,
  fastBoard, positionInputsV7, superkoHistory
- `utils/`: goRules, gameLogic, superko
- `types.ts`: reduced to the types these files use

Local changes: `types.ts` and `utils/gameLogic.ts` are reduced to what is used, and a few
array reads got a non-null `!` to pass this project's `noUncheckedIndexedAccess` setting.

They load a KataGo `.bin` network, build it in TensorFlow.js and fill KataGo v7 input planes.
The search on top of it is ours (`src/katago/`). Keep these files unmodified where possible.

The network `public/models/katago-small.bin.gz` is KataGo's
`g170-b6c96-s175395328-d26788732` test network from https://github.com/lightvector/KataGo.
