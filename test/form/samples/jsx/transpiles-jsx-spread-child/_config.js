module.exports = defineTest({
	//solo: true, //x,
	description: 'transpiles JSX spread children',
	options: {
		external: ['react'],
		jsx: 'react'
	},
	// apparently, acorn-jsx does not support spread children
	verifyAst: false
});
