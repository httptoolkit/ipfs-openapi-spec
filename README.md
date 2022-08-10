# IPFS OpenAPI Spec [![Build Status](https://github.com/httptoolkit/ipfs-openapi-spec/workflows/CI/badge.svg)](https://github.com/httptoolkit/ipfs-openapi-spec/actions) [![Spec validity](https://validator.swagger.io/validator?url=https://raw.githubusercontent.com/httptoolkit/ipfs-openapi-spec/main/ipfs-openapi.json)](https://validator.swagger.io/validator/debug?url=https://raw.githubusercontent.com/httptoolkit/ipfs-openapi-spec/main/ipfs-openapi.json)

> _Part of [HTTP Toolkit](https://httptoolkit.tech): powerful tools for building, testing & debugging HTTP(S), IPFS, and more_

An IPFS OpenAPI spec, automatically generated from the official documentation.

You can jump directly to the raw specification [here](https://raw.githubusercontent.com/httptoolkit/ipfs-openapi-spec/main/ipfs-openapi.json).

This repo pulls the raw documentation for the IPFS node RPC API in markdown format from https://raw.githubusercontent.com/ipfs/ipfs-docs/main/docs/reference/kubo/rpc.md, parses it, and then generates a complete OpenAPI spec to match, including full descriptions of everything, parameter types and details, example response values, and everything else.

This results in a machine-readable specification for the IPFS node API, which you can use with the many existing tools that support OpenAPI to:

- Generate SDKs or even simple IPFS node stub severs using [openapi-generator](https://github.com/OpenAPITools/openapi-generator).
- Build [interactive documentation](https://editor.swagger.io/?url=https://raw.githubusercontent.com/httptoolkit/ipfs-openapi-spec/main/ipfs-openapi.json) to play around with your IPFS node directly.
- Fuzz your IPFS node via [openapi-fuzzer](https://github.com/matusf/openapi-fuzzer).
- Drop this spec into tools like Postman and others to more easily make requests to your node's API.
- Programmatically explore & interact with the entire IPFS API yourself, any other way you like.

---

_This‌ ‌project‌ ‌has‌ ‌received‌ ‌funding‌ ‌from‌ ‌the‌ ‌European‌ ‌Union’s‌ ‌Horizon‌ ‌2020‌‌ research‌ ‌and‌ ‌innovation‌ ‌programme‌ ‌within‌ ‌the‌ ‌framework‌ ‌of‌ ‌the‌ ‌NGI-POINTER‌‌ Project‌ ‌funded‌ ‌under‌ ‌grant‌ ‌agreement‌ ‌No‌ 871528._

![The NGI logo and EU flag](./ngi-eu-footer.png)