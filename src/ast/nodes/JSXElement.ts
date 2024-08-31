import type MagicString from 'magic-string';
import type { NormalizedJsxOptions } from '../../rollup/types';
import { getRenderedJsxChildren } from '../../utils/jsx';
import type { RenderOptions } from '../../utils/renderHelpers';
import type { InclusionContext } from '../ExecutionContext';
import type Variable from '../variables/Variable';
import type JSXAttribute from './JSXAttribute';
import type JSXClosingElement from './JSXClosingElement';
import JSXEmptyExpression from './JSXEmptyExpression';
import JSXExpressionContainer from './JSXExpressionContainer';
import type JSXFragment from './JSXFragment';
import type JSXOpeningElement from './JSXOpeningElement';
import JSXSpreadAttribute from './JSXSpreadAttribute';
import type JSXSpreadChild from './JSXSpreadChild';
import type JSXText from './JSXText';
import type * as NodeType from './NodeType';
import JSXElementBase from './shared/JSXElementBase';
import type { IncludeChildren } from './shared/Node';

type JsxMode =
	| {
			mode: 'preserve' | 'classic';
			factory: string | null;
			importSource: string | null;
	  }
	| { mode: 'automatic'; factory: string; importSource: string };

export default class JSXElement extends JSXElementBase {
	type!: NodeType.tJSXElement;
	openingElement!: JSXOpeningElement;
	closingElement!: JSXClosingElement | null;
	children!: (JSXText | JSXExpressionContainer | JSXElement | JSXFragment | JSXSpreadChild)[];

	private factoryVariable: Variable | null = null;
	private factory: string | null = null;
	// TODO Lukas use improved type so that mode and the rest align
	private declare jsxMode: JsxMode;

	// TODO Lukas add import source here
	initialise() {
		super.initialise();
		const { importSource } = (this.jsxMode = this.getRenderingMode());
		if (importSource) {
			this.scope.context.addImportSource(importSource);
		}
	}

	include(context: InclusionContext, includeChildrenRecursively: IncludeChildren) {
		if (!this.included) {
			const { factory, importSource, mode } = this.jsxMode;
			if (importSource) {
				this.scope.context.addImportSource(importSource);
			}
			if (factory) {
				this.factory = factory;
				this.factoryVariable = this.getAndIncludeFactoryVariable(
					factory,
					mode === 'preserve',
					importSource
				);
			}
		}
		super.include(context, includeChildrenRecursively);
	}

	render(code: MagicString, options: RenderOptions): void {
		switch (this.jsxMode.mode) {
			case 'classic': {
				this.renderClassicMode(code, options);
				break;
			}
			case 'automatic': {
				this.renderAutomaticMode(code, options);
				break;
			}
			default: {
				super.render(code, options);
			}
		}
	}

	private getRenderingMode(): JsxMode {
		const jsx = this.scope.context.options.jsx as NormalizedJsxOptions;
		const { mode, factory, importSource } = jsx;
		if (mode === 'automatic') {
			// In the case there is a key after a spread attribute, we fall back to
			// classic mode, see https://github.com/facebook/react/issues/20031#issuecomment-710346866
			// for reasoning.
			let hasSpread = false;
			for (const attribute of this.openingElement.attributes) {
				if (attribute instanceof JSXSpreadAttribute) {
					hasSpread = true;
				} else if (hasSpread && attribute.name.name === 'key') {
					return { factory, importSource, mode: 'classic' };
				}
			}
			return {
				factory: getRenderedJsxChildren(this.children) > 1 ? 'jsxs' : 'jsx',
				importSource: jsx.jsxImportSource,
				mode
			};
		}
		return { factory, importSource, mode };
	}

	private renderClassicMode(code: MagicString, options: RenderOptions) {
		const {
			snippets: { getPropertyAccess },
			useOriginalName
		} = options;
		const {
			children,
			end,
			factory,
			jsxMode: { mode },
			openingElement: {
				attributes,
				name: { start: nameStart, end: nameEnd },
				selfClosing,
				end: openingEnd,
				start: openingStart
			},
			factoryVariable
		} = this;
		const [, ...nestedName] = factory!.split('.');
		code.update(
			openingStart,
			nameStart,
			`/*#__PURE__*/${[factoryVariable!.getName(getPropertyAccess, useOriginalName), ...nestedName].join('.')}(`
		);
		this.openingElement.render(code, options, { jsxMode: mode });

		let hasSpread = false;
		let inObject = false;
		let previousEnd = nameEnd;
		let hasAttributes = false;
		for (const attribute of attributes) {
			if (attribute instanceof JSXSpreadAttribute) {
				if (inObject) {
					if (hasAttributes) {
						code.appendLeft(previousEnd, ' ');
					}
					code.appendLeft(previousEnd, '},');
					inObject = false;
				} else {
					code.appendLeft(previousEnd, ',');
				}
				previousEnd = attribute.end;
				hasSpread = true;
			} else {
				code.appendLeft(previousEnd, ',');
				if (!inObject) {
					code.prependRight(attribute.start, '{ ');
					inObject = true;
				}
				previousEnd = attribute.end;
				hasAttributes = true;
			}
		}
		if (inObject) {
			code.appendLeft(previousEnd, ' }');
		}
		if (hasSpread) {
			if (hasAttributes) {
				const { start } = attributes[0];
				if (attributes[0] instanceof JSXSpreadAttribute) {
					code.prependRight(start, '{}, ');
				}
				code.prependRight(start, 'Object.assign(');
				code.update(previousEnd, openingEnd, ')');
			} else {
				code.update(previousEnd, openingEnd, '');
			}
		} else if (hasAttributes) {
			code.update(previousEnd, openingEnd, '');
		} else {
			code.update(previousEnd, openingEnd, ', null');
		}
		previousEnd = openingEnd;
		for (const child of children) {
			if (
				child instanceof JSXExpressionContainer &&
				child.expression instanceof JSXEmptyExpression
			) {
				code.remove(previousEnd, child.end);
			} else {
				code.appendLeft(previousEnd, `, `);
				child.render(code, options);
			}
			previousEnd = child.end;
		}
		if (selfClosing) {
			code.appendLeft(end, ')');
		} else {
			this.closingElement!.render(code);
		}
	}

	private renderAutomaticMode(code: MagicString, options: RenderOptions) {
		const {
			snippets: { getPropertyAccess },
			useOriginalName
		} = options;
		// TODO Lukas extract more this values
		const {
			factoryVariable,
			openingElement: {
				attributes,
				end,
				start,
				name: { start: nameStart, end: nameEnd },
				selfClosing
			}
		} = this;
		code.update(
			start,
			nameStart,
			`/*#__PURE__*/${factoryVariable!.getName(getPropertyAccess, useOriginalName)}(`
		);
		this.openingElement.render(code, options, { jsxMode: this.jsxMode.mode });
		// TODO Lukas
		// - render children first
		// - if we have a spread and either regular attributes, a key attribute or children, then we need Object.assign
		// - if we only have a single spread, we just print the object
		// - otherwise we print a regular object
		let keyAttribute: JSXAttribute | null = null;
		let hasSpread = false;
		let inObject = true;
		let previousEnd = nameEnd;
		let hasAttributes = false;
		for (const attribute of attributes) {
			if (attribute instanceof JSXSpreadAttribute) {
				if (inObject) {
					if (hasAttributes) {
						code.appendLeft(previousEnd, ' ');
					}
					code.appendLeft(previousEnd, '},');
					inObject = false;
				} else if (hasAttributes) {
					code.appendLeft(previousEnd, ',');
				}
				previousEnd = attribute.end;
				hasAttributes = true;
				hasSpread = true;
			} else if (attribute.name.name === 'key') {
				keyAttribute = attribute;
				code.remove(previousEnd, attribute.value?.start || attribute.end);
			} else {
				if (hasAttributes) {
					code.appendLeft(previousEnd, ',');
				}
				if (!inObject) {
					code.appendLeft(previousEnd, ' {');
					inObject = true;
				}
				previousEnd = attribute.end;
				hasAttributes = true;
			}
		}
		code.prependLeft(nameEnd, hasSpread ? ', Object.assign({' : ', {');
		const closeObjectAssign = hasSpread ? ')' : '';
		const renderedChildren = getRenderedJsxChildren(this.children);
		let prependComma = false;
		// TODO Lukas can we handle commas differently?
		for (const child of this.children) {
			if (
				child instanceof JSXExpressionContainer &&
				child.expression instanceof JSXEmptyExpression
			) {
				code.remove(child.start, child.end);
			} else {
				child.render(code, options);
				if (prependComma) {
					code.appendLeft(child.start, `, `);
				} else {
					prependComma = true;
				}
			}
		}
		if (renderedChildren > 0) {
			if (hasAttributes) {
				code.appendLeft(previousEnd, ',');
			}
			if (!inObject) {
				code.appendLeft(previousEnd, ' {');
			}
			code.update(
				attributes.at(-1)?.end || previousEnd,
				end,
				` children: ${renderedChildren > 1 ? '[' : ''}`
			);
			const childrenClose = renderedChildren > 1 ? ']' : '';
			if (keyAttribute) {
				const { value } = keyAttribute;
				if (value) {
					code.prependRight(value.start, `${childrenClose} }${closeObjectAssign}, `);
					code.move(value.start, value.end, this.closingElement!.start);
				} else {
					code.prependRight(
						this.closingElement!.start,
						`${childrenClose} }${closeObjectAssign}, true`
					);
				}
			} else {
				// We need to attach to the right as children are not rendered yet and
				// this appendLeft will not append to things appended by the children
				code.prependRight(this.closingElement!.start, `${childrenClose} }${closeObjectAssign}`);
			}
		} else {
			if (inObject) {
				if (hasAttributes) {
					code.appendLeft(previousEnd, ' ');
				}
				code.update(attributes.at(-1)?.end || previousEnd, end, '}' + closeObjectAssign);
			} else {
				code.update(previousEnd, end, ')');
			}
			if (keyAttribute) {
				const { value } = keyAttribute;
				// This will appear to the left of the moved code...
				code.appendLeft(end, ', ');
				if (value) {
					if (selfClosing) {
						// ...and this will appear to the right
						code.appendLeft(value.end, ')');
					}
					code.move(value.start, value.end, end);
				} else {
					code.appendLeft(end, 'true');
					if (selfClosing) {
						code.appendLeft(end, ')');
					}
				}
			} else if (selfClosing) {
				code.appendLeft(end, ')');
			}
		}
		// TODO Lukas inline removal?
		this.closingElement?.render(code);
	}
}
