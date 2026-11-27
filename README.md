# JSONKeeper

JSONKeeper is a GDPR-aware runtime for Node.js applications that use MongoDB through the **official driver**, without Mongoose. It adapts the runtime enforcement design of [RuleKeeper](https://github.com/mafsbaptista/rulekeeper) (Ferreira et al., IEEE S&P 2023) to schemaless JSON documents. It also tests the paper's claim that RuleKeeper is portable across web stacks.

> **Status: in development.** This repository currently contains the original RuleKeeper code, unmodified, as the baseline we build from. JSONKeeper's own components will be added alongside it. See [Repository layout](#repository-layout).

## Motivation

RuleKeeper lets developers write a GDPR manifest declaring personal data, purposes, lawful bases and consent. It then enforces that manifest at runtime. Its prototype targets the MERN stack, and its database enforcement depends on Mongoose:

- The runtime database hooks are installed as Mongoose schema plugins (`schema.pre` / `schema.post`).
- Collection names and data owners are resolved through Mongoose models (`mongoose.models`).

Many MongoDB applications skip Mongoose. They call the official driver directly and store documents with no declared schema, so RuleKeeper cannot protect them. Most document stores are built on JSON, so removing the Mongoose requirement opens this approach to a much wider set of applications.

## How JSONKeeper works

JSONKeeper wraps the driver's collection objects in a JavaScript `Proxy`. With no schema to consult, it inspects queries and documents directly to work out which fields each operation touches. It then checks those fields against the manifest before letting the operation through.

| Component | Role | RuleKeeper counterpart |
| --- | --- | --- |
| **GDPR manifest** | RuleKeeper's DSL, with data mapped to JSON key paths within a collection (e.g. `address.street`) | `Parser/` |
| **Request-context middleware** | Identifies the principal and the operation (HTTP method + route) for each request, carried with `AsyncLocalStorage` | `hooks/context.js`, `hooks/cookies.js` (`request-context`) |
| **Driver hook** | `Proxy` around driver collection methods; extracts the key paths a query reads or writes and resolves the data subjects it affects | Mongoose hooks in `hooks/` |
| **Compliance checks** | Evaluates each access against purpose limitation, data minimization, lawfulness of processing and the data owners' consent; blocks violating queries | `pep/PolicyManager.js` + Rego policies in `RuleKeeper Manager/policies/` |

Reads are checked after the query returns. Writes, updates and deletes are checked before the query runs.

### Planned differences from RuleKeeper

- **Every document is checked.** For multi-document reads, RuleKeeper extracts keys from the first returned document only, which its code marks as a TODO. In a schemaless collection, documents can have different keys, so JSONKeeper merges the keys of every returned document.
- **Every array element is checked.** RuleKeeper's key flattening looks only inside an array's first element. JSONKeeper walks all elements.
- **Update operators are understood.** Fields written through operators such as `$set`, `$unset` and `$push` are resolved to the key paths they modify.
- **Denials are thrown errors.** A blocked query rejects with a compliance error that the application's Express error handler can map to a response. RuleKeeper's hooks end the HTTP response and leave the query pending.
- **Context uses `AsyncLocalStorage`.** This replaces the `request-context` package, which relies on Node's deprecated `domain` module.

### Scope

The first version targets `insertOne`/`insertMany`, `find`/`findOne`, `updateOne`/`updateMany` and `deleteOne`/`deleteMany`. Aggregation pipelines are out of scope. Porting RuleKeeper's static analysis (the Data Processing Graph) is a stretch goal.

## Repository layout

These directories come from RuleKeeper and are unchanged:

| Path | Contents |
| --- | --- |
| `Parser/` | TypeScript parser that compiles the GDPR manifest DSL to JSON |
| `RuleKeeper Middleware/` | Runtime enforcement: request context, consent cookies, Mongoose hooks, policy enforcement point |
| `RuleKeeper Manager/` | Manager service: Rego policies (evaluated by Open Policy Agent), consent and principal storage, consent banner UI |
| `Static Analysis Engine/` | Offline analysis that builds a code graph and checks it against the manifest |
| `Usability Tests/` | Material from RuleKeeper's usability study |
| `Use Cases/` | The MERN applications RuleKeeper was evaluated on (amazona, blog-app, habitica, leb, webus) |

JSONKeeper's own code will live in new top-level directories so the baseline stays easy to diff against upstream.

## Evaluation plan

We will compare JSONKeeper with RuleKeeper on four questions:

1. **Expressiveness:** can key-path manifests express the data-protection policies of real applications?
2. **Violation detection:** does the runtime block bugs and attacks that violate the manifest?
3. **Access inference:** without a schema, how accurately does the driver hook identify the fields each endpoint touches?
4. **Developer effort:** how long does it take to set JSONKeeper up on a simple application?

## Acknowledgments

JSONKeeper builds directly on **RuleKeeper** by Mafalda Ferreira, Tiago Brito, José Fragoso Santos and Nuno Santos (INESC-ID / Instituto Superior Técnico, Universidade de Lisboa). The manifest DSL, the policy model and the runtime enforcement design are theirs, and this repository includes their code as its starting point.

- Original repository: <https://github.com/mafsbaptista/rulekeeper> (code imported at commit [`a29bc1a`](https://github.com/mafsbaptista/rulekeeper/commit/a29bc1ae7a9a75fbe8d6f079237925a79e161169); licensed under Apache 2.0 in [`588866b`](https://github.com/mafsbaptista/rulekeeper/commit/588866b02758608ea351d8ad5bff138df05bd055))
- Paper: [RuleKeeper: GDPR-Aware Personal Data Compliance for Web Frameworks](https://doi.org/10.1109/SP46215.2023.10179395), IEEE Symposium on Security and Privacy (S&P), 2023

If you use this work, please cite the original paper:

```bibtex
@inproceedings{ferreira2023rulekeeper,
  title     = {RuleKeeper: GDPR-Aware Personal Data Compliance for Web Frameworks},
  author    = {Ferreira, Mafalda and Brito, Tiago and Fragoso Santos, Jos{\'e} and Santos, Nuno},
  booktitle = {2023 IEEE Symposium on Security and Privacy (SP)},
  year      = {2023},
  doi       = {10.1109/SP46215.2023.10179395}
}
```

We thank Mafalda Ferreira for permission to build on RuleKeeper and for releasing it under the Apache License 2.0.

## License

JSONKeeper is licensed under the [Apache License 2.0](LICENSE), the same license as RuleKeeper.

The RuleKeeper code in this repository is Copyright 2023 Mafalda Ferreira and is used under the Apache License 2.0. See [NOTICE](NOTICE) for attribution. Files we modify from RuleKeeper carry a notice at the top stating that they were changed.