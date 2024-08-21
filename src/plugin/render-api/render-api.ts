import { MarkdownRendererOptions } from "./api-options";
import { Component, Notice, WorkspaceLeaf, MarkdownRenderer as ObsidianRenderer, MarkdownPreviewView, loadMermaid, TFile, MarkdownView, View } from "obsidian";
import { TabManager } from "plugin/utils/tab-manager";
import * as electron from 'electron';
import { Settings, SettingsPage } from "plugin/settings/settings";
import { Path } from "plugin/utils/path";
import { SimpleFileListGenerator } from "plugin/features/simple-list-generator";
import { IncludeGenerator } from "plugin/features/include";
import { DataviewRenderer } from "./dataview-renderer";
import { debug } from "console";

export namespace MarkdownRendererAPI
{
	export const viewableMediaExtensions = ["png", "jpg", "jpeg", "svg", "gif", "bmp", "ico", "mp4", "mov", "avi", "webm", "mpeg", "mp3", "wav", "ogg", "aac", "pdf", "html", "htm", "json", "txt", "yaml"];
	export const convertableExtensions = ["md", "canvas", "drawing", "excalidraw", ...viewableMediaExtensions]; // drawing is an alias for excalidraw

	export function extentionToTag(extention: string)
	{
		if (["png", "jpg", "jpeg", "svg", "gif", "bmp", "ico"].includes(extention)) return "img";
		else if (["mp4", "mov", "avi", "webm", "mpeg"].includes(extention)) return "video";
		else if (["mp3", "wav", "ogg", "aac"].includes(extention)) return "audio";
		else if (["pdf"].includes(extention)) return "embed";
		else return "iframe";
	}

	function makeHeadingsTrees(html: HTMLElement)
	{

		// make headers into format:
		/*
		- .heading-wrapper
			- h1.heading
				- .heading-collapse-indicator.collapse-indicator.collapse-icon
				- "Text"
			- .heading-children 
		*/

		function getHeaderEl(headingContainer: HTMLDivElement)
		{
			const first = headingContainer.firstElementChild;
			if (first && /[Hh][1-6]/g.test(first.tagName)) return first;
			else return;
		}
		
		function makeHeaderTree(headerDiv: HTMLDivElement, childrenContainer: HTMLElement)
		{
			const headerEl = getHeaderEl(headerDiv);

			if (!headerEl) return;

			let possibleChild = headerDiv.nextElementSibling;

			while (possibleChild != null)
			{
				const possibleChildHeader = getHeaderEl(possibleChild as HTMLDivElement);

				if(possibleChildHeader)
				{
					// if header is a sibling of this header then break
					if (possibleChildHeader.tagName <= headerEl.tagName)
					{
						break;
					}

					// if we reached the footer then break
					if (possibleChildHeader.querySelector(":has(section.footnotes)") || possibleChildHeader.classList.contains("mod-footer"))
					{
						break;
					}
				}

				const nextEl = possibleChild.nextElementSibling;
				childrenContainer.appendChild(possibleChild);
				possibleChild = nextEl;
			}
		}

		html.querySelectorAll("div:has(> :is(h1, h2, h3, h4, h5, h6):not([class^='block-language-'] *)):not(.markdown-sizer)").forEach(function (header: HTMLDivElement)
		{
			header.classList.add("heading-wrapper");

			const hEl = getHeaderEl(header) as HTMLHeadingElement;

			if (!hEl || hEl.classList.contains("heading")) return;

			hEl.classList.add("heading");

			let collapseIcon = hEl.querySelector(".heading-collapse-indicator");
			if (!collapseIcon)
			{
				collapseIcon = hEl.createDiv({ cls: "heading-collapse-indicator collapse-indicator collapse-icon" });
				collapseIcon.innerHTML = _MarkdownRendererInternal.arrowHTML;
				hEl.prepend(collapseIcon);
			}

			const children = header.createDiv({ cls: "heading-children" });

			makeHeaderTree(header, children);
		});

		// add "heading" class to all headers that don't have it
		html.querySelectorAll(":is(h1, h2, h3, h4, h5, h6):not(.heading)").forEach((el) => el.classList.add("heading"));

		// remove collapsible arrows from h1 and inline titles
		html.querySelectorAll("div h1, div .inline-title").forEach((element) =>
		{
			element.querySelector(".heading-collapse-indicator")?.remove();
		});

		// remove all new lines from header elements which cause spacing issues
		html.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((el) => el.innerHTML = el.innerHTML.replaceAll("\n", ""));
	}

	export async function renderMarkdownToString(markdown: string, options?: MarkdownRendererOptions): Promise<string | undefined>
	{
		options = Object.assign(new MarkdownRendererOptions(), options);
		const html = await _MarkdownRendererInternal.renderMarkdown(markdown, options);
		if (!html) return;
		if(options.postProcess) await _MarkdownRendererInternal.postProcessHTML(html, options);
		if (options.makeHeadersTrees) makeHeadingsTrees(html);
		const text = html.innerHTML;
		if (!options.container) html.remove();
		return text;
	}

	export async function renderMarkdownToElement(markdown: string, options?: MarkdownRendererOptions): Promise<HTMLElement | undefined>
	{
		options = Object.assign(new MarkdownRendererOptions(), options);
		const html = await _MarkdownRendererInternal.renderMarkdown(markdown, options);
		if (!html) return;
		if(options.postProcess) await _MarkdownRendererInternal.postProcessHTML(html, options);
		if (options.makeHeadersTrees) makeHeadingsTrees(html);
		return html;
	}

	export async function renderFile(file: TFile, options?: MarkdownRendererOptions): Promise<{contentEl: HTMLElement; viewType: string;} | undefined>
	{
		options = Object.assign(new MarkdownRendererOptions(), options);
		const result = await _MarkdownRendererInternal.renderFile(file, options);
		if (!result) return;


		if (options.postProcess) await _MarkdownRendererInternal.postProcessHTML(result.contentEl, options);
		if (options.makeHeadersTrees) makeHeadingsTrees(result.contentEl);

		return result;
	}

	export async function renderFileToString(file: TFile, options?: MarkdownRendererOptions): Promise<string | undefined>
	{
		options = Object.assign(new MarkdownRendererOptions(), options);
		const result = await this.renderFile(file, options);
		if (!result) return;
		const text = result.contentEl.innerHTML;
		if (!options.container) result.contentEl.remove();
		return text;
	}

	export async function renderMarkdownSimple(markdown: string): Promise<string | undefined>
	{
		const container = document.body.createDiv();
		await _MarkdownRendererInternal.renderSimpleMarkdown(markdown, container);
		const text = container.innerHTML;
		container.remove();
		return text;
	}

	export async function renderMarkdownSimpleEl(markdown: string, container: HTMLElement)
	{
		await _MarkdownRendererInternal.renderSimpleMarkdown(markdown, container);
	}

	export function isConvertable(extention: string)
	{
		if (extention.startsWith(".")) extention = extention.substring(1);
		return this.convertableExtensions.contains(extention);
	}

	export function checkCancelled(): boolean
	{
		return _MarkdownRendererInternal.checkCancelled();
	}

	export async function beginBatch(options?: MarkdownRendererOptions)
	{
		options = Object.assign(new MarkdownRendererOptions(), options);
		await _MarkdownRendererInternal.beginBatch(options);
	}

	export function endBatch()
	{
		_MarkdownRendererInternal.endBatch();
	}

}

export namespace _MarkdownRendererInternal
{
	export let renderLeaf: WorkspaceLeaf | undefined;
	export let electronWindow: electron.BrowserWindow | undefined;
    export let errorInBatch: boolean = false;
	export let cancelled: boolean = false;
	export let batchStarted: boolean = false;
	let logContainer: HTMLElement | undefined;
	let loadingContainer: HTMLElement | undefined;
	let fileListContainer: HTMLElement | undefined;

	export const batchDocument = document.implementation.createHTMLDocument();
	let markdownView: MarkdownView | undefined;

	const infoColor = "var(--text-normal)";
	const warningColor = "var(--color-yellow)";
	const errorColor = "var(--color-red)";
	const infoBoxColor = "rgba(0,0,0,0.15)"
	const warningBoxColor = "rgba(var(--color-yellow-rgb), 0.15)";
	const errorBoxColor = "rgba(var(--color-red-rgb), 0.15)";
	export const arrowHTML = "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' class='svg-icon right-triangle'><path d='M3 8L12 17L21 8'></path></svg>";

	export function checkCancelled(): boolean
	{
		if (_MarkdownRendererInternal.cancelled || !_MarkdownRendererInternal.renderLeaf) 
		{
			ExportLog.log("cancelled");
			_MarkdownRendererInternal.endBatch();
			return true;
		}

		return false;
	}

	async function delay (ms: number)
	{
		return new Promise( resolve => setTimeout(resolve, ms) );
	}

	async function  waitUntil(condition: () => boolean, timeout: number = 1000, interval: number = 100): Promise<boolean>
	{
		if (condition()) return true;
		
		return new Promise((resolve, reject) => {
			let timer = 0;
			const intervalId = setInterval(() => {
				if (condition()) {
					clearInterval(intervalId);
					resolve(true);
				} else {
					timer += interval;
					if (timer >= timeout) {
						clearInterval(intervalId);
						resolve(false);
					}
				}
			}, interval);
		});
	}

	function failRender(file: TFile | undefined, message: any): undefined
	{
		if (checkCancelled()) return undefined;

		ExportLog.error(message, `Rendering ${file?.path ?? " custom markdown "} failed: `);
		return;
	}

	export async function renderFile(file: TFile, options: MarkdownRendererOptions): Promise<{contentEl: HTMLElement, viewType: string} | undefined>
	{
		if (MarkdownRendererAPI.viewableMediaExtensions.contains(file.extension))
		{
			return {contentEl: await createMediaPage(file, options), viewType: "attachment"};
		}

		const loneFile = !batchStarted;
		if (loneFile) 
		{
			ExportLog.log("Exporting single file, starting batch");
			await _MarkdownRendererInternal.beginBatch(options);
		}

		const success = await waitUntil(() => renderLeaf != undefined || checkCancelled(), 2000, 1);
		if (!success || !renderLeaf) return failRender(file, "Failed to get leaf for rendering!");

		let html: HTMLElement | undefined;
		
		try
		{ 
			await renderLeaf.openFile(file, { active: false});
		}
		catch (e)
		{
			return failRender(file, e);
		}
		
		const view = renderLeaf.view;
		const viewType = view.getViewType();

		switch(viewType)
		{
			case "markdown":
				// @ts-ignore
				const preview = view.previewMode;
				html = await renderMarkdownView(preview, options);
				break;
			case "kanban":
				html = await renderGeneric(view, options);
				break;
			case "excalidraw":
				html = await renderExcalidraw(view, options);
				break;
			case "canvas":
				html = await renderCanvas(view, options);
				break;
			default:
				html = await renderGeneric(view, options);
				break;
		}

		if(checkCancelled()) return undefined;
		if (!html) return failRender(file, "Failed to render file!");

		if (loneFile) _MarkdownRendererInternal.endBatch();

		return {contentEl: html, viewType: viewType};
	}

	export async function renderMarkdown(markdown: string, options: MarkdownRendererOptions): Promise<HTMLElement | undefined>
	{
		const loneFile = !batchStarted;
		if (loneFile) 
		{
			ExportLog.log("Exporting single file, starting batch");
			await _MarkdownRendererInternal.beginBatch(options);
		}

		const success = await waitUntil(() => renderLeaf != undefined || checkCancelled(), 2000, 1);
		if (!success || !renderLeaf) return failRender(undefined, "Failed to get leaf for rendering!");
		

		const view: MarkdownView = markdownView ?? new MarkdownView(renderLeaf);
		renderLeaf.view = view;

		try
		{ 
			view.setViewData(markdown, false);
		}
		catch (e)
		{
			return failRender(undefined, e);
		}


		let html: HTMLElement | undefined;

		// @ts-ignore
		const preview = view.previewMode;
		html = await renderMarkdownView(preview, options);

		if(checkCancelled()) return undefined;
		if (!html) return failRender(undefined, "Failed to render file!");

		if (loneFile) _MarkdownRendererInternal.endBatch();

		return html;
	}

	export async function renderMarkdownView(preview: MarkdownPreviewView, options: MarkdownRendererOptions): Promise<HTMLElement | undefined>
	{
		preview.load();
		// @ts-ignore
		const renderer = preview.renderer;

		try
		{
			await renderer.unfoldAllHeadings();
			await renderer.unfoldAllLists();
			await renderer.parseSync();
		}
		catch (e)
		{
			ExportLog.error(e, "Failed to unfold or parse renderer!");
		}

		// @ts-ignore
		if (!window.mermaid)
		{
			await loadMermaid();
		}

		const sections = renderer.sections as {"rendered": boolean, "height": number, "computed": boolean, "lines": number, "lineStart": number, "lineEnd": number, "used": boolean, "highlightRanges": number, "level": number, "headingCollapsed": boolean, "shown": boolean, "usesFrontMatter": boolean, "html": string, "el": HTMLElement}[];

		// @ts-ignore
		const newMarkdownEl = document.body.createDiv({ attr: {class: "obsidian-document " + (preview.renderer?.previewEl?.className ?? "")} });
		const newSizerEl = newMarkdownEl.createDiv({ attr: {class:"markdown-sizer"} });

		if (!newMarkdownEl || !newSizerEl) return failRender(preview.file, "Please specify a container element, or enable keepViewContainer!");

		preview.containerEl = newSizerEl;

		// @ts-ignore
		const promises: Promise<any>[] = [];
		const foldedCallouts: HTMLElement[] = [];
		for (const section of sections)
		{
			section.shown = true;
			section.rendered = false;
			// @ts-ignore
			section.resetCompute();
			// @ts-ignore
			section.setCollapsed(false);
			section.el.empty();

			newSizerEl.appendChild(section.el);

			// @ts-ignore
			await section.render();

			// @ts-ignore
			let success = await waitUntil(() => (section.el && section.rendered) || checkCancelled(), 2000, 1);
			if (!success) return failRender(preview.file, "Failed to render section!");

			await renderer.measureSection(section);
			success = await waitUntil(() => section.computed || checkCancelled(), 2000, 1);
			if (!success) return failRender(preview.file, "Failed to compute section!");

			// compile dataview
			const dataviewInfo = DataviewRenderer.getDataviewFromHTML(section.el);
			if (dataviewInfo) 
			{
				const dataviewContainer = document.body.createDiv();
				dataviewContainer.classList.add(`block-language-${dataviewInfo.keyword}`);
				dataviewInfo.preEl.replaceWith(dataviewContainer);
				await new DataviewRenderer(preview, preview.file, dataviewInfo?.query, dataviewInfo.keyword).generate(dataviewContainer);
			}

			// @ts-ignore
			await preview.postProcess(section, promises, renderer.frontmatter);

			// unfold callouts
			const folded = Array.from(section.el.querySelectorAll(".callout-content[style*='display: none']")) as HTMLElement[];
			for (const callout of folded)
			{
				callout.style.display = "";
			}
			foldedCallouts.push(...folded);

			// wait for transclusions
			await waitUntil(() => !section.el.querySelector(".markdown-sizer:empty") || checkCancelled(), 500, 1);
			if (checkCancelled()) return undefined;

			if (section.el.querySelector(".markdown-sizer:empty"))
			{
				ExportLog.warning("Transclusions were not rendered correctly in file " + preview.file.name + "!");
			}

			// wait for generic plugins
			await waitUntil(() => !section.el.querySelector("[class^='block-language-']:empty") || checkCancelled(), 500, 1);
			if (checkCancelled()) return undefined;

			// convert canvas elements into images here because otherwise they will lose their data when moved
			const canvases = Array.from(section.el.querySelectorAll("canvas:not(.pdf-embed canvas)")) as HTMLCanvasElement[];
			for (const canvas of canvases)
			{
				const data = canvas.toDataURL();
				if (data.length < 100) 
				{
					ExportLog.log(canvas.outerHTML, "Failed to render canvas based plugin element in file " + preview.file.name + ":");
					canvas.remove();
					continue;
				}

				const image = document.body.createEl("img");
				image.src = data;
				image.style.width = canvas.style.width || "100%";
				image.style.maxWidth = "100%";
				canvas.replaceWith(image);
			};

			//console.debug(section.el.outerHTML); // for some reason adding this line here fixes an issue where some plugins wouldn't render

			const invalidPluginBlocks = Array.from(section.el.querySelectorAll("[class^='block-language-']:empty"));
			for (const block of invalidPluginBlocks)
			{
				ExportLog.warning(`Plugin element ${block.className || block.parentElement?.className || "unknown"} from ${preview.file.name} not rendered correctly!`);
			}
		}

		// @ts-ignore
		await Promise.all(promises);

		// refold callouts
		for (const callout of foldedCallouts)
		{
			callout.style.display = "none";
		}

		newSizerEl.empty();

		// create the markdown-preview-pusher element
		if (options.createPusherElement)
		{
			newSizerEl.createDiv({ attr: {class:"markdown-pusher", style:"width: 1px; height: 0.1px; margin-bottom: 0px;"} });
		}

		// move all of them back in since rendering can cause some sections to move themselves out of their container
		for (const section of sections)
		{
			newSizerEl.appendChild(section.el.cloneNode(true));
		}

		// get banner plugin banner and insert it before the sizer element
		const banner = preview.containerEl.querySelector(".obsidian-banner-wrapper");
		if (banner)
		{
			newSizerEl.before(banner);
		}

		// if we aren't kepping the view element then only keep the content of the sizer element
		if (options.createDocumentContainer === false) 
		{
			newMarkdownEl.outerHTML = newSizerEl.innerHTML;
		}

		options.container?.appendChild(newMarkdownEl);

		return newMarkdownEl;
	}

	export async function renderSimpleMarkdown(markdown: string, container: HTMLElement)
	{
		const renderComp = new Component();
		renderComp.load();
		await ObsidianRenderer.render(app, markdown, container, "/", renderComp);
		renderComp.unload();

		const renderedEl = container.children[container.children.length - 1];
		if (renderedEl && renderedEl.tagName == "P")
		{
			renderedEl.outerHTML = renderedEl.innerHTML; // remove the outer <p> tag
		}

		// remove tags
		container.querySelectorAll("a.tag").forEach((element: HTMLAnchorElement) =>
		{
			element.remove();
		});
		
		//remove rendered lists and replace them with plain text
		container.querySelectorAll("ol").forEach((listEl: HTMLElement) =>
		{
			if(listEl.parentElement)
			{
				const start = listEl.getAttribute("start") ?? "1";
				listEl.parentElement.createSpan().outerHTML = `${start}. ${listEl.innerText}`;
				listEl.remove();
			}
		});
		container.querySelectorAll("ul").forEach((listEl: HTMLElement) =>
		{
			if(listEl.parentElement)
			{
				listEl.parentElement.createSpan().innerHTML = "- " + listEl.innerHTML;
				listEl.remove();
			}
		});
		container.querySelectorAll("li").forEach((listEl: HTMLElement) =>
		{
			if(listEl.parentElement)
			{
				listEl.parentElement.createSpan().innerHTML = listEl.innerHTML;
				listEl.remove();
			}
		});
	}

	async function renderGeneric(view: View, options: MarkdownRendererOptions): Promise<HTMLElement | undefined>
	{
		await delay(2000);

		if (checkCancelled()) return undefined;

		// @ts-ignore
		const contentEl = view.containerEl;
		options.container?.appendChild(contentEl);


		return contentEl;
	}

	async function renderExcalidraw(view: any, options: MarkdownRendererOptions): Promise<HTMLElement | undefined>
	{
		await delay(500);

		// @ts-ignore
		const scene = view.excalidrawData.scene;

		// @ts-ignore
		const svg = await view.svg(scene, "", false);

		// remove rect fill
		const isLight = !svg.getAttribute("filter");
		if (!isLight) svg.removeAttribute("filter");
		svg.classList.add(isLight ? "light" : "dark");

		let contentEl = document.body.createDiv();
		contentEl.classList.add("obsidian-document");
		const sizerEl = contentEl.createDiv();
		sizerEl.classList.add("excalidraw-plugin");

		sizerEl.appendChild(svg);

		if (checkCancelled()) return undefined;

		if (options.createDocumentContainer === false)
		{
			contentEl = svg;
		}

		options.container?.appendChild(contentEl);

		return contentEl;
	}

	export async function renderCanvas(view: any, options: MarkdownRendererOptions): Promise<HTMLElement | undefined>
	{
		if (checkCancelled()) return undefined;



		// this is to decide whether to inline the HTML of certain node or not
		let allExportedPaths = Settings.getAllFilesFromPaths(options.filesToExport);

		const canvas = view.canvas;

		const nodes = canvas.nodes;
		const edges = canvas.edges;

		canvas.zoomToFit();
		await delay(500);

		for (const node of nodes)
		{
			await node[1].render();
		}

		for (const edge of edges)
		{
			await edge[1].render();
		}

		canvas.zoomToFit();
		await delay(500);

		let contentEl = view.contentEl;
		const canvasEl = contentEl.querySelector(".canvas");
		canvasEl.innerHTML = "";

		const edgeContainer = canvasEl.createEl("svg", { cls: "canvas-edges" });
		const edgeHeadContainer = canvasEl.createEl("svg", { cls: "canvas-edges" });

		for (const pair of nodes)
		{
			const node = pair[1]; // value is the node
			const nodeEl = node.nodeEl;
			const nodeFile: TFile | undefined = node.file ?? undefined;
			const embedEl = nodeEl.querySelector(".markdown-embed-content.node-insert-event");
			const childPreview = node?.child?.previewMode;

			if (embedEl) embedEl.innerHTML = "";

			const optionsCopy = Object.assign({}, options);
			optionsCopy.container = embedEl;

			if (nodeFile && embedEl)
			{
				console.log(allExportedPaths, nodeFile.path);
				if ((options.inlineHTML || !allExportedPaths.contains(nodeFile.path)) && childPreview)
				{
					node.render();
					if (childPreview.owner)
					{
						childPreview.owner.file = 
							childPreview.file ?? 
							childPreview.owner.file ?? 
							view.file;
					}
					await renderMarkdownView(childPreview, optionsCopy);
				}
				else
				{
					embedEl.innerHTML = IncludeGenerator.generate(nodeFile.path, true);
					embedEl.parentElement?.classList.add("external-markdown-embed");
					embedEl.parentElement?.setAttribute("src", nodeFile.path);
				}
			}
			else if (!nodeFile && embedEl && childPreview)
			{
				node.render();
				
				if (childPreview.owner)
				{
					childPreview.owner.file = 
						childPreview.file ?? 
						childPreview.owner.file ?? 
						view.file;
				}
				await renderMarkdownView(childPreview, optionsCopy);
			}


			if (node.url)
			{
				const iframe = node.contentEl.createEl("iframe");
				iframe.src = node.url;
				iframe.classList.add("canvas-link");
				iframe.setAttribute("style", "border:none; width:100%; height:100%;");
				iframe.setAttribute("title", "Canvas card with embedded webpage: " + node.url);			
			}
			
			canvasEl.appendChild(nodeEl);
		}

		for (const edge of edges)
		{
			const edgeEl = edge[1].lineGroupEl;
			const headEl = edge[1].lineEndGroupEl;

			edgeContainer.appendChild(edgeEl);
			edgeHeadContainer.appendChild(headEl);

			if(edge[1].label)
			{
				const labelEl = edge[1].labelElement.wrapperEl;
				canvasEl.appendChild(labelEl);
			}
		}

		if (checkCancelled()) return undefined;
		
		if (options.createDocumentContainer === false)
		{
			contentEl = canvasEl;
		}
 
		options.container?.appendChild(contentEl);

		return contentEl;
	}

	export async function createMediaPage(file: TFile, options: MarkdownRendererOptions): Promise<HTMLElement>
	{
		const contentEl = batchDocument.body.createDiv({ attr: {class:"obsidian-document"} });
		const embedType = MarkdownRendererAPI.extentionToTag(file.extension);

		let media = contentEl.createEl(embedType);

		if (media instanceof HTMLVideoElement || media instanceof HTMLAudioElement)
			media.controls = true;

		let path = file.path;
		if (file.extension == "html")
		{
			let pathObj = new Path(path);
			pathObj.setFileName(pathObj.basename + "-content");
		}
		media.src = file.path;

		options.container?.appendChild(contentEl);
		contentEl.appendChild(media);
		return contentEl;
	}

	export async function postProcessHTML(html: HTMLElement, options: MarkdownRendererOptions)
	{
		if (!html.classList.contains("obsidian-document"))
		{
			const viewContainer = (html.classList.contains("view-content") || html.classList.contains("markdown-preview-view")) ? html : html.querySelector(".view-content, .markdown-preview-view");
			if (!viewContainer)
			{
				ExportLog.error("Failed to find view container in rendered HTML!");
				return;
			}

			viewContainer.classList.add("obsidian-document");
		}

		// remove the extra elements if they are not wanted
		if (options.createDocumentContainer === false)
		{
			html.querySelectorAll(".mod-header, .mod-footer").forEach((e: HTMLElement) => e.remove());
		}

		// transclusions put a div inside a p tag, which is invalid html. Fix it here
		html.querySelectorAll("p:has(div)").forEach((element) =>
		{
			// replace the p tag with a span
			const span = document.body.createEl("span");
			span.innerHTML = element.innerHTML;
			element.replaceWith(span);
			span.style.display = "block";
			span.style.marginBlockStart = "var(--p-spacing)";
			span.style.marginBlockEnd = "var(--p-spacing)";
		});

		// encode all text input values into attributes
		html.querySelectorAll("input[type=text]").forEach((element: HTMLElement) =>
		{
			// @ts-ignore
			element.setAttribute("value", element.value);
			// @ts-ignore
			element.value = "";
		});

		// encode all text area values into text content
		html.querySelectorAll("textarea").forEach((element: HTMLElement) =>
		{
			// @ts-ignore
			element.textContent = element.value;
		});
		
		// convert tag href to search query
		html.querySelectorAll("a.tag").forEach((element: HTMLAnchorElement) =>
		{
			const split = element.href.split("#");
			const tag = split[1] ?? element.href.substring(1); // remove the #
			element.setAttribute("data-href", element.getAttribute("href") ?? "");
			element.setAttribute("href", `?query=tag:${tag}`);
		});

		// convert all hard coded image / media widths into max widths
		html.querySelectorAll("img, video, .media-embed:has( > :is(img, video))").forEach((element: HTMLElement) =>
		{
			const width = element.getAttribute("width");
			if (width)
			{
				element.removeAttribute("width");
				element.style.width = (width.trim() != "") ? (width + "px") : "";
				element.style.maxWidth = "100%";
			}
		});

		// replace obsidian's pdf embeds with normal embeds
		html.querySelectorAll("span.internal-embed.pdf-embed").forEach((pdf: HTMLElement) =>
		{
			const embed = document.body.createEl("embed");
			embed.setAttribute("src", pdf.getAttribute("src") ?? "");
			embed.style.width = pdf.style.width || '100%';
			embed.style.maxWidth = "100%";
			embed.style.height = pdf.style.height || '800px';

			const container = pdf.parentElement?.parentElement;
			
			container?.querySelectorAll("*").forEach((el) => el.remove());

			if (container) container.appendChild(embed);
		});

		// remove all MAKE.md elements
		html.querySelectorAll("div[class^='mk-']").forEach((element: HTMLElement) =>
		{
			element.remove();
		});

		// move frontmatter before markdown-preview-sizer
		const frontmatter = html.querySelector(".frontmatter");
		if (frontmatter)
		{
			const frontmatterParent = frontmatter.parentElement;
			const sizer = html.querySelector(".markdown-sizer");
			if (sizer)
			{
				sizer.before(frontmatter);
			}
			frontmatterParent?.remove();
		}

		// add lazy loading to iframe elements
		html.querySelectorAll("iframe").forEach((element: HTMLIFrameElement) =>
		{
			element.setAttribute("loading", "lazy");
		});

		// add collapse icons to lists if they don't already have them
		const collapsableListItems = Array.from(html.querySelectorAll("li:has(ul), li:has(ol)"));
		for (const item of collapsableListItems)
		{
			let collapseIcon = item.querySelector(".collapse-icon");
			if (!collapseIcon)
			{
				collapseIcon = item.createDiv({ cls: "list-collapse-indicator collapse-indicator collapse-icon" });
				collapseIcon.innerHTML = this.arrowHTML;
				item.prepend(collapseIcon);
			}
		}

		// if the dynamic table of contents plugin is included on this page
		// then parse each list item and render markdown for it
		const tocEls = Array.from(html.querySelectorAll(".block-language-toc.dynamic-toc li > a"));
		for (const element of tocEls)
		{
			const renderEl = document.body.createDiv();
			renderSimpleMarkdown(element.textContent ?? "", renderEl);
			element.textContent = renderEl.textContent;
			renderEl.remove();
		}
	}

    export async function beginBatch(options: MarkdownRendererOptions)
	{
		if(batchStarted) return;

        errorInBatch = false;
		cancelled = false;
		batchStarted = true;
		loadingContainer = undefined;
		logContainer = undefined;
		logShowing = false;
		batchDocument.open();
		if (!batchDocument.body)
		{
			batchDocument.write("<body></body>");		
		}

		renderLeaf = TabManager.openNewTab("window", "vertical");

		markdownView = new MarkdownView(renderLeaf);

		// @ts-ignore
		const parentFound = await waitUntil(() => (renderLeaf && renderLeaf.parent) || checkCancelled(), 2000, 1);
		if (!parentFound) 
		{
			try
			{
				renderLeaf.detach();
			}
			catch (e)
			{
				ExportLog.error(e, "Failed to detach render leaf: ");
			}
			
			if (!checkCancelled())
			{
				new Notice("Error: Failed to create leaf for rendering!");
				throw new Error("Failed to create leaf for rendering!");
			}
			
			return;
		}

		const obsidianWindow = renderLeaf.view.containerEl.win;
		// @ts-ignore
		electronWindow = obsidianWindow.electronWindow as electron.BrowserWindow;

		if (!electronWindow) 
		{
			new Notice("Failed to get the render window, please try again.");
			errorInBatch = false;
			cancelled = false;
			batchStarted = false;
			renderLeaf = undefined;
			electronWindow = undefined;
			return;
		}

		if (options.displayProgress === false) 
		{
			const newPosition = {x: 0, y: window.screen.height};
			obsidianWindow.moveTo(newPosition.x, newPosition.y);
			electronWindow.hide();
		}
		else
		{
			// hide the leaf so we can render without intruding on the user
			// @ts-ignore
			renderLeaf.parent.containerEl.style.height = "0";
			// @ts-ignore
			renderLeaf.parent.parent.containerEl.querySelector(".clickable-icon, .workspace-tab-header-container-inner").style.display = "none";
			// @ts-ignore
			renderLeaf.parent.containerEl.style.maxHeight = "var(--header-height)";
			// @ts-ignore
			renderLeaf.parent.parent.containerEl.classList.remove("mod-vertical");
			// @ts-ignore
			renderLeaf.parent.parent.containerEl.classList.add("mod-horizontal");

			const newSize = { width: 900, height: 400 };
			obsidianWindow.resizeTo(newSize.width, newSize.height);
			const newPosition = {x: window.screen.width / 2 - 450, y: window.screen.height - 450 - 75};
			obsidianWindow.moveTo(newPosition.x, newPosition.y);
		}

		electronWindow.setAlwaysOnTop(true, "floating", 1);
		electronWindow.webContents.setBackgroundThrottling(false);

		function windowClosed()
		{
			if (cancelled) return;
			endBatch();
			cancelled = true;
			electronWindow?.off("close", windowClosed);
		}

		electronWindow.on("close", windowClosed);


		createLoadingContainer();
	}

	export function endBatch()
	{
		if (!batchStarted) return;

		if (renderLeaf)
		{
            if (!errorInBatch)
			{
				ExportLog.log("Closing render window");
			    renderLeaf.detach();
			}
			else
			{
				ExportLog.warning("Error in batch, leaving render window open");
				_reportProgress(1, "Completed with errors", "Please see the log for more details.", errorColor);
			}
		}

		electronWindow = undefined;
		renderLeaf = undefined;
		loadingContainer = undefined;
		fileListContainer = undefined;

		batchStarted = false;
	}

	function generateLogEl(title: string, message: any, textColor: string, backgroundColor: string): HTMLElement
	{
		const logEl = batchDocument.body.createEl("div");
		logEl.className = "html-progress-log-item";
		logEl.style.display = "flex";
		logEl.style.flexDirection = "column";
		logEl.style.marginBottom = "2px";
		logEl.style.fontSize = "12px";
		logEl.innerHTML =
		`
		<div class="html-progress-log-title" style="font-weight: bold; margin-left: 1em;"></div>
		<div class="html-progress-log-message" style="margin-left: 2em; font-size: 0.8em;white-space: pre-wrap;"></div>
		`;
		logEl.querySelector(".html-progress-log-title")!.textContent = title;
		logEl.querySelector(".html-progress-log-message")!.textContent = message.toString();

		logEl.style.color = textColor;
		logEl.style.backgroundColor = backgroundColor;
		logEl.style.borderLeft = `5px solid ${textColor}`;
		logEl.style.borderBottom = "1px solid var(--divider-color)";
		logEl.style.borderTop = "1px solid var(--divider-color)";

		return logEl;
	}

	function createLoadingContainer()
	{
		if (!loadingContainer) 
		{
			loadingContainer = batchDocument.body.createDiv();
			loadingContainer.outerHTML = 
			`
			<div class="html-progress-wrapper">
				<div class="html-progress-content">
					<div class="html-progress-inner">
						<h1>Generating HTML</h1>
						<progress class="html-progress-bar" value="0" min="0" max="1"></progress>
						<span class="html-progress-sub"></span>
					</div>
					<div class="html-progress-log">
						<h1>Export Log</h1>
					</div>
				</div>
			</div>
			`
			loadingContainer = batchDocument.querySelector(".html-progress-wrapper") as HTMLElement;

			// @ts-ignore
			renderLeaf.parent.parent.containerEl.appendChild(loadingContainer);
		}
	}

	let logShowing = false;
	function appendLogEl(logEl: HTMLElement)
	{
		logContainer = loadingContainer?.querySelector(".html-progress-log") ?? undefined;

		if(!logContainer || !renderLeaf)
		{
			console.error("Failed to append log element, log container or render leaf is undefined!");
			return;
		}

		if (!logShowing) 
		{
			renderLeaf.view.containerEl.win.resizeTo(1000, 500);
			logContainer.style.display = "flex";
			logShowing = true;
		}

		logContainer.appendChild(logEl);
		// @ts-ignore
		logEl.scrollIntoView({ behavior: "instant", block: "end", inline: "end" });	
	}

	export async function _reportProgress(fraction: number, message: string, subMessage: string, progressColor: string)
	{
		if (!batchStarted) return;

		// @ts-ignore
		if (!renderLeaf?.parent?.parent) return;

		// @ts-ignore
		const loadingContainer = renderLeaf.parent.parent.containerEl.querySelector(`.html-progress-wrapper`);
		if (!loadingContainer) return;

		const progressBar = loadingContainer.querySelector("progress");
		if (progressBar)
		{
			progressBar.value = fraction;
			progressBar.style.backgroundColor = "transparent";
			progressBar.style.color = progressColor;
		}


		const messageElement = loadingContainer.querySelector("h1");
		if (messageElement)
		{
			messageElement.innerText = message;
		}

		const subMessageElement = loadingContainer.querySelector("span.html-progress-sub") as HTMLElement;
		if (subMessageElement)
		{
			subMessageElement.innerText = subMessage;
		}

		electronWindow?.setProgressBar(fraction);
	}

	export async function _setFileList(items: string[], options: {icons?: string[] | string, renderAsMarkdown?: boolean, title?: string})
	{
		const contaienr = loadingContainer?.querySelector(".html-progress-content") as HTMLElement;
		if (!contaienr) return;
		
		const fileList = new SimpleFileListGenerator(items, options);
		const fileListEl = await fileList.generate(contaienr);
		contaienr.prepend(fileListEl);
		if (fileListContainer) fileListContainer.remove();
		fileListContainer = fileListEl;
	}

	export async function _reportError(messageTitle: string, message: any, fatal: boolean)
	{
		if (!batchStarted) return;

		errorInBatch = true;

		// @ts-ignore
		const found = await waitUntil(() => renderLeaf && renderLeaf.parent && renderLeaf.parent.parent, 100, 10);
		if (!found) return;

		appendLogEl(generateLogEl(messageTitle, message, errorColor, errorBoxColor));

		if (fatal)
        {
			renderLeaf = undefined;
			loadingContainer = undefined;
			logContainer = undefined;
        }
	}

	export async function _reportWarning(messageTitle: string, message: any)
	{
		if (!batchStarted) return;

		// @ts-ignore
		const found = await waitUntil(() => renderLeaf && renderLeaf.parent && renderLeaf.parent.parent, 100, 10);
		if (!found) return;

		appendLogEl(generateLogEl(messageTitle, message, warningColor, warningBoxColor));
	}

    export async function _reportInfo(messageTitle: string, message: any)
	{
		if (!batchStarted) return;

		// @ts-ignore
		const found = await waitUntil(() => renderLeaf && renderLeaf.parent && renderLeaf.parent.parent, 100, 10);
		if (!found) return;

		appendLogEl(generateLogEl(messageTitle, message, infoColor, infoBoxColor));
	}

}

export namespace ExportLog
{
    export let fullLog: string = "";

    function logToString(message: any, title: string)
    {
        const messageString = (typeof message === "string") ? message : JSON.stringify(message).replaceAll("\n", "\n\t\t");
        const titleString = title != "" ? title + "\t" : "";
        const log = `${titleString}${messageString}\n`;
        return log;
    }

    function humanReadableJSON(object: any)
    {
        const string = JSON.stringify(object, null, 2).replaceAll(/\"|\{|\}|,/g, "").split("\n").map((s) => s.trim()).join("\n\t");
        // make the properties into a table
        let lines = string.split("\n");
        lines = lines.filter((line) => line.contains(":"));
        const names = lines.map((line) => line.split(":")[0] + " ");
        const values = lines.map((line) => line.split(":").slice(1).join(":"));
        const maxLength = Math.max(...names.map((name) => name.length)) + 3;
        let table = "";
        for (let i = 0; i < names.length; i++)
        {
            const padString = i % 2 == 0 ? "-" : " ";
            table += `${names[i].padEnd(maxLength, padString)}${values[i]}\n`;
        }

        return table;
    }

    export function log(message: any, messageTitle: string = "")
    {
        pullPathLogs();

        messageTitle = `[INFO] ${messageTitle}`
        fullLog += logToString(message, messageTitle);

		if(SettingsPage.loaded && !(Settings.logLevel == "all")) return;

        if (messageTitle != "") console.log(messageTitle + " ", message);
        else console.log(message);
        _MarkdownRendererInternal._reportInfo(messageTitle, message);
    }

    export function warning(message: any, messageTitle: string = "")
    {
        pullPathLogs();

        messageTitle = `[WARNING] ${messageTitle}`
        fullLog += logToString(message, messageTitle);

		if(SettingsPage.loaded && !["warning", "all"].contains(Settings.logLevel)) return;

        if (messageTitle != "") console.warn(messageTitle + " ", message);
        else console.warn(message);
        _MarkdownRendererInternal._reportWarning(messageTitle, message);
    }

    export function error(message: any, messageTitle: string = "", fatal: boolean = false)
    {
        pullPathLogs();

        messageTitle = (fatal ? "[FATAL ERROR] " : "[ERROR] ") + messageTitle;
        fullLog += logToString(message, messageTitle);

        if (SettingsPage.loaded && !fatal && !["error", "warning", "all"].contains(Settings.logLevel)) return;
		
        if (fatal && messageTitle == "Error") messageTitle = "Fatal Error";

        if (messageTitle != "") console.error(messageTitle + " ", message);
        else console.error(message);

        _MarkdownRendererInternal._reportError(messageTitle, message, fatal);
    }

    export function progress(fraction: number, message: string, subMessage: string, progressColor: string = "var(--interactive-accent)")
    {
		fullLog += logToString({fraction, message, subMessage}, "Progress");
        pullPathLogs();
        _MarkdownRendererInternal._reportProgress(fraction, message, subMessage, progressColor);
    }

	export function setFileList(items: string[], options: {icons?: string[] | string, renderAsMarkdown?: boolean, title?: string})
	{
		_MarkdownRendererInternal._setFileList(items, options);		
	}

    function pullPathLogs()
    {
        const logs = Path.dequeueLog();
        for (const thisLog of logs)
        {
            switch (thisLog.type)
            {
                case "info":
                    log(thisLog.message, thisLog.title);
                    break;
                case "warn":
                    warning(thisLog.message, thisLog.title);
                    break;
                case "error":
                    error(thisLog.message, thisLog.title, false);
                    break;
                case "fatal":
                    error(thisLog.message, thisLog.title, true);
                    break;
            }
        }
    }

    export function getDebugInfo()
    {
        let debugInfo = "";

        debugInfo += `Log:\n${fullLog}\n\n`;

        const settingsCopy = Object.assign({}, Settings);
        //@ts-ignore
        settingsCopy.filesToExport = settingsCopy.filesToExport[0].length;
        debugInfo += `Settings:\n${humanReadableJSON(settingsCopy)}\n\n`;

        // @ts-ignore
        const loadedPlugins = Object.values(app.plugins.plugins).filter((plugin) => plugin._loaded == true).map((plugin) => plugin.manifest.name).join("\n\t");
        debugInfo += `Enabled Plugins:\n\t${loadedPlugins}`;

        return debugInfo;
    }

    export function testThrowError(chance: number)
    {
        if (Math.random() < chance)
        {
            throw new Error("Test error");
        }
    }

	export function isCancelled()
	{
		return _MarkdownRendererInternal.checkCancelled();
	}
}

