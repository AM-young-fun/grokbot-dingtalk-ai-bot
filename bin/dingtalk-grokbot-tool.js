#!/usr/bin/env node

import { runCli } from '../src/dingtalk-tool-cli.js';

process.exitCode = await runCli(process.argv.slice(2));
