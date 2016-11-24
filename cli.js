#!/usr/bin/env node
'use strict';

const path = require('path');
const getStdin = require('get-stdin');
const globby = require('globby');
const entries = require('lodash/entries');
const kebabCase = require('lodash/kebabCase');
const snakeCase = require('lodash/snakeCase');
const meow = require('meow');
const sander = require('sander');
const html = require('js-beautify').html;

const cli = meow(`
Usage
  $ html <input> [flags]

Options
  --e4x, --jsx, -x              Pass through JSX/E4X [false]
  --editorconfig, -c            Use .editorconfig for options [false]
  --end-with-newline, -n        Ensure newline at file end [false]
  --eol, -e                     Carriage return character ["\\n"]
  --indent-character, -i        Indentation character [" "]
  --indent-level, -l            Initial indentation level [0]
  --indent-size, -s             Indentation size [4]
  --max-preserve-newlines, -m   Count of newlines to preserve per chunk [10]
  --preserve-newlines, -p       Preserve newlines [true]

Examples
  $ html index.html # overwrites in place

	$ html docs/**/*.html # overwrites in place

  $ echo "<span>html</span>" | html
  <span>
    html
  </span>

  $ echo "<span>html</span>" > index.html && html < index.html
  <span>
    html
  </span>
`);

const booleans = [
	'jsx', 'editorconfig', 'end-with-newline',
	'eol', 'preserve-newlines'
];

const strings = [
	'eol', 'indent-character'
];

const numbers = [
	'indent-level', 'indent-size', 'max-preserve-newlines'
];

main(cli.input, cli.flags)
	.catch(err => {
		if (err.managed) {
			console.error(`${cli.help}\n\n  ${err.message}`);
			process.exit(1);
		}
		setTimeout(() => {
			throw err;
		});
	});

// (input: Array<string>, flags: any) => Promise<void>
function main(input, raw) {
	return Promise.resolve()
		.then(() => {
			const flags = getFlags(raw);
			const out = input.length === 0 ?
				(filename, content) => process.stdout.write(content) :
				(filename, content) => sander.writeFile(filename, content);
			const pretty = content => html(content, flags);

			return {flags, out, pretty};
		})
		.then(context => {
			return getContents(input)
				.then(files => {
					context.files = files;
					return context;
				});
		})
		.then(context => {
			context.results = context.files.map(file => {
				const [name, content] = file;
				return [name, context.pretty(content, context.flags)];
			});
			return context;
		})
		.then(context => {
			context.results.forEach(entry => context.out(...entry));
			return context;
		});
}

// (input: Array<string>) => Promise<Array[filename: null|string, content: string]>
function getContents(input) {
	if (input.length === 0) {
		return getStdin()
			.then(stdin => {
				if (!stdin) {
					const error = new Error(`Either <input> or stdin is required.`);
					error.managed = true;
					throw error;
				}
				return [[null, stdin]];
			});
	}
	return globby(input)
		.then(files => Promise.all(
			files
				.filter(file => path.extname(file) === '.html')
				.map(file => sander.readFile(file).then(contents => [file, contents.toString()]))
		)
	);
}

// (raw: any) => any
function getFlags(raw) {
	const rawFlagEntries = entries(raw)
		.map(entry => {
			const [name, value] = entry;
			return [kebabCase(name), value];
		});

	const violations = rawFlagEntries
		.map(flag => {
			const [flagName, flagValue] = flag;
			if (booleans.includes(flagName)) {
				return typeof flagValue === 'boolean' ?
					null : [flagName, flagValue, 'boolean', typeof flagValue];
			}
			if (strings.includes(flagName)) {
				return typeof flagValue === 'string' ?
					null : [flagName, flagValue, 'string', typeof flagValue];
			}
			if (numbers.includes(flagName)) {
				return typeof flagValue === 'number' ?
					null : [flagName, flagValue, 'number', typeof flagValue];
			}
			return null;
		})
		.filter(Array.isArray);

	if (violations.length > 0) {
		const messages = violations
			.map(violation => {
				const [name, value, expected, actual] = violation;
				return `Expected flag ${name} to be of type "${expected}". Received value "${value}" with type "${actual}".`;
			});

		const error = new Error(messages.join('\n'));
		error.managed = true;
		throw error;
	}

	return rawFlagEntries.reduce((flags, flag) => {
		const [flagName, flagValue] = flag;
		flags[snakeCase(flagName)] = flagValue;
		return flags;
	}, {});
}
