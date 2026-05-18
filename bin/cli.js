#!/usr/bin/env node
'use strict';

const { program } = require('commander');
const { setup } = require('../src/setup');
const { install, uninstall } = require('../src/install');
const { checkout } = require('../src/checkout');

program
  .name('get-lem-ai')
  .description('get-lem-ai — generate Implementation.md on branch creation')
  .version('1.0.0');

program.command('setup').description('Configure webhook URL').action(setup);
program.command('install').description('Install git hook into current repo').action(install);
program.command('uninstall').description('Remove git hook from current repo').action(uninstall);
program.command('checkout <branchName>').description('Internal: called by git hook').action(checkout);

program.parse(process.argv);
