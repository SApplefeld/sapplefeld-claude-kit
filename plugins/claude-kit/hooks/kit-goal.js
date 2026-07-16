#!/usr/bin/env node
// CLI entry for the kit-native goal continuity mechanism.
//
// Subcommands:
//   kit-goal.js arm <planPath>   arm a goal against a plan doc
//   kit-goal.js clear            clear any armed goal
//   kit-goal.js status           report whether a goal is armed
//
// Invoked by the /kit-goal skill. All filesystem work is delegated to
// kit-goal-lib.js; this file is only argument parsing and output formatting.

'use strict';

const { armGoal, clearGoal, readGoal } = require('./kit-goal-lib.js');

// Repo-controlled strings (a plan path) are sanitized to printable ASCII and
// length-capped before they reach stdout/stderr, matching the sibling hooks'
// convention for any repo data entering a trusted output channel.
function sanitize(s) {
    return String(s).replace(/[^\x20-\x7E]/g, '').slice(0, 120);
}

function usage() {
    process.stderr.write('usage: kit-goal.js arm <planPath> | clear | status\n');
    process.exitCode = 1;
}

function cmdArm(planArg) {
    if (!planArg) {
        usage();
        return;
    }
    try {
        const result = armGoal(process.cwd(), planArg);
        if (result.ok) {
            process.stdout.write('kit goal armed for ' + sanitize(result.plan) + '\n');
            process.exitCode = 0;
        } else {
            process.stderr.write('kit-goal: ' + sanitize(result.reason) + '\n');
            process.exitCode = 1;
        }
    } catch (err) {
        process.stderr.write('kit-goal: ' + sanitize(err.message) + '\n');
        process.exitCode = 1;
    }
}

function cmdClear() {
    const result = clearGoal(process.cwd());
    if (!result.ok) {
        // The state file exists but could not be deleted: the leash is still
        // armed and enforcing, so this must not read as a successful clear.
        process.stderr.write('kit-goal: ' + sanitize(result.reason) + ' (the goal is still armed)\n');
        process.exitCode = 1;
        return;
    }
    process.stdout.write((result.cleared ? 'kit goal cleared' : 'no kit goal was armed') + '\n');
    process.exitCode = 0;
}

function cmdStatus() {
    const state = readGoal(process.cwd());
    if (state) {
        const binding = state.boundSession
            ? 'bound to session ' + sanitize(state.boundSession)
            : 'unbound';
        process.stdout.write(
            'kit goal armed for ' + sanitize(state.plan)
            + ' (armed ' + sanitize(state.armedAt) + '; ' + binding + ')\n'
        );
    } else {
        process.stdout.write('no kit goal armed\n');
    }
    process.exitCode = 0;
}

// The /kit-goal skill documents these as clear aliases (matching native
// /goal); honoring them in the CLI too means a direct alias call is not a
// silent usage error.
const CLEAR_ALIASES = new Set(['clear', 'stop', 'off', 'reset', 'none', 'cancel']);

function main() {
    const [cmd, arg] = process.argv.slice(2);
    if (cmd === 'arm') cmdArm(arg);
    else if (CLEAR_ALIASES.has(cmd)) cmdClear();
    else if (cmd === 'status') cmdStatus();
    else usage();
}

main();
