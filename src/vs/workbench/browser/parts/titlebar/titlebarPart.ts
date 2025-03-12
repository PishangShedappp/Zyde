/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/titlebarpart.css';
import { localize, localize2 } from '../../../../nls.js';
import { MultiWindowParts, Part } from '../../part.js';
import { ITitleService } from '../../../services/title/browser/titleService.js';
import { getWCOTitlebarAreaRect, getZoomFactor, isWCOEnabled } from '../../../../base/browser/browser.js';
import { MenuBarVisibility, getTitleBarStyle, getMenuBarVisibility, hasCustomTitlebar, hasNativeTitlebar, DEFAULT_CUSTOM_TITLEBAR_HEIGHT } from '../../../../platform/window/common/window.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { StandardMouseEvent } from '../../../../base/browser/mouseEvent.js';
import { IConfigurationService, IConfigurationChangeEvent } from '../../../../platform/configuration/common/configuration.js';
import { DisposableStore, IDisposable } from '../../../../base/common/lifecycle.js';
import { IBrowserWorkbenchEnvironmentService } from '../../../services/environment/browser/environmentService.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { TITLE_BAR_ACTIVE_BACKGROUND, TITLE_BAR_ACTIVE_FOREGROUND, TITLE_BAR_INACTIVE_FOREGROUND, TITLE_BAR_INACTIVE_BACKGROUND, TITLE_BAR_BORDER, WORKBENCH_BACKGROUND } from '../../../common/theme.js';
import { isMacintosh, isWindows, isLinux, isWeb, isNative, platformLocale } from '../../../../base/common/platform.js';
import { Color } from '../../../../base/common/color.js';
import { EventType, EventHelper, Dimension, append, $, addDisposableListener, prepend, reset, getWindow, getWindowId, isAncestor, getActiveDocument, isHTMLElement } from '../../../../base/browser/dom.js';
import { CustomMenubarControl } from './menubarControl.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { Parts, IWorkbenchLayoutService, ActivityBarPosition, LayoutSettings, EditorActionsLocation, EditorTabsMode } from '../../../services/layout/browser/layoutService.js';
import { createActionViewItem, fillInActionBarActions as fillInActionBarActions } from '../../../../platform/actions/browser/menuEntryActionViewItem.js';
import { Action2, IMenu, IMenuService, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { WindowTitle } from './windowTitle.js';
import { CommandCenterControl } from './commandCenterControl.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { WorkbenchToolBar } from '../../../../platform/actions/browser/toolbar.js';
import { ACCOUNTS_ACTIVITY_ID, GLOBAL_ACTIVITY_ID } from '../../../common/activity.js';
import { AccountsActivityActionViewItem, isAccountsActionVisible, SimpleAccountActivityActionViewItem, SimpleGlobalActivityActionViewItem } from '../globalCompositeBar.js';
import { HoverPosition } from '../../../../base/browser/ui/hover/hoverWidget.js';
import { IEditorGroupsContainer, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { ActionRunner, IAction } from '../../../../base/common/actions.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ActionsOrientation, IActionViewItem, prepareActions } from '../../../../base/browser/ui/actionbar/actionbar.js';
import { EDITOR_CORE_NAVIGATION_COMMANDS } from '../editor/editorCommands.js';
import { AnchorAlignment } from '../../../../base/browser/ui/contextview/contextview.js';
import { EditorPane } from '../editor/editorPane.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { ResolvedKeybinding } from '../../../../base/common/keybindings.js';
import { EditorCommandsContextActionRunner } from '../editor/editorTabsControl.js';
import { IEditorCommandsContext, IEditorPartOptionsChangeEvent, IToolbarActions } from '../../../common/editor.js';
import { CodeWindow, mainWindow } from '../../../../base/browser/window.js';
import { ACCOUNTS_ACTIVITY_TILE_ACTION, GLOBAL_ACTIVITY_TITLE_ACTION } from './titlebarActions.js';
import { IView } from '../../../../base/browser/ui/grid/grid.js';
import { createInstantHoverDelegate } from '../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { IBaseActionViewItemOptions } from '../../../../base/browser/ui/actionbar/actionViewItems.js';
import { IHoverDelegate } from '../../../../base/browser/ui/hover/hoverDelegate.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { safeIntl } from '../../../../base/common/date.js';
import { TitleBarVisibleContext } from '../../../common/contextkeys.js';
import { IWorkspacesService } from '../../../../platform/workspaces/common/workspaces.js';

export interface ITitleVariable {
	readonly name: string;
	readonly contextKey: string;
}

export interface ITitleProperties {
	isPure?: boolean;
	isAdmin?: boolean;
	prefix?: string;
}

export interface ITitlebarPart extends IDisposable {

	/**
	 * An event when the menubar visibility changes.
	 */
	readonly onMenubarVisibilityChange: Event<boolean>;

	/**
	 * Update some environmental title properties.
	 */
	updateProperties(properties: ITitleProperties): void;

	/**
	 * Adds variables to be supported in the window title.
	 */
	registerVariables(variables: ITitleVariable[]): void;
}

export class BrowserTitleService extends MultiWindowParts<BrowserTitlebarPart> implements ITitleService {

	declare _serviceBrand: undefined;

	readonly mainPart = this._register(this.createMainTitlebarPart());

	constructor(
		@IInstantiationService protected readonly instantiationService: IInstantiationService,
		@IStorageService storageService: IStorageService,
		@IThemeService themeService: IThemeService
	) {
		super('workbench.titleService', themeService, storageService);

		this._register(this.registerPart(this.mainPart));

		this.registerActions();
		this.registerAPICommands();
	}

	protected createMainTitlebarPart(): BrowserTitlebarPart {
		return this.instantiationService.createInstance(MainBrowserTitlebarPart);
	}

	private registerActions(): void {

		// Focus action
		const that = this;
		this._register(registerAction2(class FocusTitleBar extends Action2 {

			constructor() {
				super({
					id: `workbench.action.focusTitleBar`,
					title: localize2('focusTitleBar', 'Focus Title Bar'),
					category: Categories.View,
					f1: true,
					precondition: TitleBarVisibleContext
				});
			}

			run(): void {
				that.getPartByDocument(getActiveDocument())?.focus();
			}
		}));
	}

	private registerAPICommands(): void {
		this._register(CommandsRegistry.registerCommand({
			id: 'registerWindowTitleVariable',
			handler: (accessor: ServicesAccessor, name: string, contextKey: string) => {
				this.registerVariables([{ name, contextKey }]);
			},
			metadata: {
				description: 'Registers a new title variable',
				args: [
					{ name: 'name', schema: { type: 'string' }, description: 'The name of the variable to register' },
					{ name: 'contextKey', schema: { type: 'string' }, description: 'The context key to use for the value of the variable' }
				]
			}
		}));
	}

	//#region Auxiliary Titlebar Parts

	createAuxiliaryTitlebarPart(container: HTMLElement, editorGroupsContainer: IEditorGroupsContainer): IAuxiliaryTitlebarPart {
		const titlebarPartContainer = $('.part.titlebar', { role: 'none' });
		titlebarPartContainer.style.position = 'relative';
		container.insertBefore(titlebarPartContainer, container.firstChild); // ensure we are first element

		const disposables = new DisposableStore();

		const titlebarPart = this.doCreateAuxiliaryTitlebarPart(titlebarPartContainer, editorGroupsContainer);
		disposables.add(this.registerPart(titlebarPart));

		disposables.add(Event.runAndSubscribe(titlebarPart.onDidChange, () => titlebarPartContainer.style.height = `${titlebarPart.height}px`));
		titlebarPart.create(titlebarPartContainer);

		if (this.properties) {
			titlebarPart.updateProperties(this.properties);
		}

		if (this.variables.size) {
			titlebarPart.registerVariables(Array.from(this.variables.values()));
		}

		Event.once(titlebarPart.onWillDispose)(() => disposables.dispose());

		return titlebarPart;
	}

	protected doCreateAuxiliaryTitlebarPart(container: HTMLElement, editorGroupsContainer: IEditorGroupsContainer): BrowserTitlebarPart & IAuxiliaryTitlebarPart {
		return this.instantiationService.createInstance(AuxiliaryBrowserTitlebarPart, container, editorGroupsContainer, this.mainPart);
	}

	//#endregion


	//#region Service Implementation

	readonly onMenubarVisibilityChange = this.mainPart.onMenubarVisibilityChange;

	private properties: ITitleProperties | undefined = undefined;

	updateProperties(properties: ITitleProperties): void {
		this.properties = properties;

		for (const part of this.parts) {
			part.updateProperties(properties);
		}
	}

	private readonly variables = new Map<string, ITitleVariable>();

	registerVariables(variables: ITitleVariable[]): void {
		const newVariables: ITitleVariable[] = [];

		for (const variable of variables) {
			if (!this.variables.has(variable.name)) {
				this.variables.set(variable.name, variable);
				newVariables.push(variable);
			}
		}

		for (const part of this.parts) {
			part.registerVariables(newVariables);
		}
	}

	//#endregion
}

export class BrowserTitlebarPart extends Part implements ITitlebarPart {

	//#region IView

	readonly minimumWidth: number = 0;
	readonly maximumWidth: number = Number.POSITIVE_INFINITY;

	get minimumHeight(): number {
		const wcoEnabled = isWeb && isWCOEnabled();
		let value = this.isCommandCenterVisible || wcoEnabled ? DEFAULT_CUSTOM_TITLEBAR_HEIGHT : 30;
		if (wcoEnabled) {
			value = Math.max(value, getWCOTitlebarAreaRect(getWindow(this.element))?.height ?? 0);
		}

		return value / (this.preventZoom ? getZoomFactor(getWindow(this.element)) : 1);
	}

	get maximumHeight(): number { return this.minimumHeight; }

	//#endregion

	//#region Events

	private _onMenubarVisibilityChange = this._register(new Emitter<boolean>());
	readonly onMenubarVisibilityChange = this._onMenubarVisibilityChange.event;

	private readonly _onWillDispose = this._register(new Emitter<void>());
	readonly onWillDispose = this._onWillDispose.event;

	//#endregion

	protected rootContainer!: HTMLElement;
	protected dragRegion: HTMLElement | undefined;
	private title!: HTMLElement;

	private leftContent!: HTMLElement;
	private centerContent!: HTMLElement;
	private rightContent!: HTMLElement;

	protected customMenubar: CustomMenubarControl | undefined;
	protected appIcon: HTMLElement | undefined;
	private appIconBadge: HTMLElement | undefined;
	protected menubar?: HTMLElement;
	private lastLayoutDimensions: Dimension | undefined;

	private actionToolBar!: WorkbenchToolBar;
	private readonly actionToolBarDisposable = this._register(new DisposableStore());
	private readonly editorActionsChangeDisposable = this._register(new DisposableStore());
	private actionToolBarElement!: HTMLElement;

	private globalToolbarMenu = this._register(this.menuService.createMenu(MenuId.TitleBar, this.contextKeyService));
	private hasGlobalToolbarEntries = false;
	private layoutToolbarMenu: IMenu | undefined;

	private readonly globalToolbarMenuDisposables = this._register(new DisposableStore());
	private readonly editorToolbarMenuDisposables = this._register(new DisposableStore());
	private readonly layoutToolbarMenuDisposables = this._register(new DisposableStore());
	private readonly activityToolbarDisposables = this._register(new DisposableStore());

	private readonly hoverDelegate: IHoverDelegate;

	private readonly titleDisposables = this._register(new DisposableStore());
	private titleBarStyle = getTitleBarStyle(this.configurationService);

	private isInactive: boolean = false;
	private readonly isAuxiliary: boolean;

	private readonly windowTitle: WindowTitle;

	private readonly editorService: IEditorService;
	private readonly editorGroupsContainer: IEditorGroupsContainer;

	constructor(
		id: string,
		targetWindow: CodeWindow,
		editorGroupsContainer: IEditorGroupsContainer | 'main',
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IConfigurationService protected readonly configurationService: IConfigurationService,
		@IBrowserWorkbenchEnvironmentService protected readonly environmentService: IBrowserWorkbenchEnvironmentService,
		@IInstantiationService protected readonly instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService,
		@IStorageService private readonly storageService: IStorageService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IHostService private readonly hostService: IHostService,
		@IEditorGroupsService private readonly editorGroupService: IEditorGroupsService,
		@IEditorService editorService: IEditorService,
		@IMenuService private readonly menuService: IMenuService,
		@IKeybindingService private readonly keybindingService: IKeybindingService
	) {
		super(id, { hasTitle: false }, themeService, storageService, layoutService);

		this.isAuxiliary = editorGroupsContainer !== 'main';
		this.editorService = editorService.createScoped(editorGroupsContainer, this._store);
		this.editorGroupsContainer = editorGroupsContainer === 'main' ? editorGroupService.mainPart : editorGroupsContainer;

		this.windowTitle = this._register(instantiationService.createInstance(WindowTitle, targetWindow, editorGroupsContainer));

		this.hoverDelegate = this._register(createInstantHoverDelegate());

		this.registerListeners(getWindowId(targetWindow));
	}

	private registerListeners(targetWindowId: number): void {
		this._register(this.hostService.onDidChangeFocus(focused => focused ? this.onFocus() : this.onBlur()));
		this._register(this.hostService.onDidChangeActiveWindow(windowId => windowId === targetWindowId ? this.onFocus() : this.onBlur()));
		this._register(this.configurationService.onDidChangeConfiguration(e => this.onConfigurationChanged(e)));
		this._register(this.editorGroupService.onDidChangeEditorPartOptions(e => this.onEditorPartConfigurationChange(e)));
	}

	private onBlur(): void {
		this.isInactive = true;

		this.updateStyles();
	}

	private onFocus(): void {
		this.isInactive = false;

		this.updateStyles();
	}

	private onEditorPartConfigurationChange({ oldPartOptions, newPartOptions }: IEditorPartOptionsChangeEvent): void {
		if (
			oldPartOptions.editorActionsLocation !== newPartOptions.editorActionsLocation ||
			oldPartOptions.showTabs !== newPartOptions.showTabs
		) {
			if (hasCustomTitlebar(this.configurationService, this.titleBarStyle) && this.actionToolBar) {
				this.createActionToolBar();
				this.createActionToolBarMenus({ editorActions: true });
				this._onDidChange.fire(undefined);
			}
		}
	}

	protected onConfigurationChanged(event: IConfigurationChangeEvent): void {

		// Custom menu bar (disabled if auxiliary)
		if (!this.isAuxiliary && !hasNativeTitlebar(this.configurationService, this.titleBarStyle) && (!isMacintosh || isWeb)) {
			if (event.affectsConfiguration('window.menuBarVisibility')) {
				if (this.currentMenubarVisibility === 'compact') {
					this.uninstallMenubar();
				} else {
					this.installMenubar();
				}
			}
		}

		// Actions
		if (hasCustomTitlebar(this.configurationService, this.titleBarStyle) && this.actionToolBar) {
			const affectsLayoutControl = event.affectsConfiguration(LayoutSettings.LAYOUT_ACTIONS);
			const affectsActivityControl = event.affectsConfiguration(LayoutSettings.ACTIVITY_BAR_LOCATION);

			if (affectsLayoutControl || affectsActivityControl) {
				this.createActionToolBarMenus({ layoutActions: affectsLayoutControl, activityActions: affectsActivityControl });

				this._onDidChange.fire(undefined);
			}
		}

		// Command Center
		if (event.affectsConfiguration(LayoutSettings.COMMAND_CENTER)) {
			this.createTitle();

			this._onDidChange.fire(undefined);
		}
	}

	protected createStackIcon(container: HTMLElement): void {
		/* STACK ICON FOR DROPDOWN WRAPPER START */
		const titlebarInfoIconWrapperSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		titlebarInfoIconWrapperSvg.setAttribute('width', '20');
		titlebarInfoIconWrapperSvg.setAttribute('height', '20');
		titlebarInfoIconWrapperSvg.setAttribute('viewBox', '0 0 20 20');
		titlebarInfoIconWrapperSvg.setAttribute('fill', 'none');

		const titlebarInfoIconWrapperSvgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
		titlebarInfoIconWrapperSvgRect.setAttribute('x', '0.0820312');
		titlebarInfoIconWrapperSvgRect.setAttribute('width', '20');
		titlebarInfoIconWrapperSvgRect.setAttribute('height', '20');
		titlebarInfoIconWrapperSvgRect.setAttribute('rx', '4');

		const titlebarInfoIconWrapperSvgG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
		titlebarInfoIconWrapperSvgG.setAttribute('clip-path', 'url(#clip0_1820_571926)');

		const titlebarInfoIconWrapperSvgMask = document.createElementNS('http://www.w3.org/2000/svg', 'mask');
		titlebarInfoIconWrapperSvgMask.setAttribute('id', 'mask0_1820_571926');
		titlebarInfoIconWrapperSvgMask.setAttribute('style', 'mask-type:luminance');
		titlebarInfoIconWrapperSvgMask.setAttribute('maskUnits', 'userSpaceOnUse');
		titlebarInfoIconWrapperSvgMask.setAttribute('x', '3');
		titlebarInfoIconWrapperSvgMask.setAttribute('y', '3');
		titlebarInfoIconWrapperSvgMask.setAttribute('width', '15');
		titlebarInfoIconWrapperSvgMask.setAttribute('height', '14');

		const titlebarInfoIconWrapperSvgMaskPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		titlebarInfoIconWrapperSvgMaskPath.setAttribute('fill', 'white');
		titlebarInfoIconWrapperSvgMaskPath.setAttribute('d', 'M3.08203 3H17.082V17H3.08203V3Z');

		titlebarInfoIconWrapperSvgMask.appendChild(titlebarInfoIconWrapperSvgMaskPath);

		const titlebarInfoIconWrapperSvgMaskedGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
		titlebarInfoIconWrapperSvgMaskedGroup.setAttribute('mask', 'url(#mask0_1820_571926)');

		const titlebarInfoIconWrapperSvgIconPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		titlebarInfoIconWrapperSvgIconPath.setAttribute('fill', '#5C6373');
		titlebarInfoIconWrapperSvgIconPath.setAttribute('d', 'M10.3616 3.94623L16.0295 7.0378C16.0786 7.06464 16.1191 7.10503 16.1459 7.15421C16.223 7.29561 16.1709 7.4728 16.0295 7.54991L10.3616 10.6415C10.1875 10.7365 9.97703 10.7365 9.80291 10.6415L4.13501 7.54991C3.99359 7.4728 3.94148 7.29561 4.01862 7.15421C4.04544 7.10503 4.08584 7.06464 4.13501 7.0378L9.80291 3.94623C9.97703 3.85126 10.1875 3.85126 10.3616 3.94623ZM4.77101 9.38307L4.81217 9.40272L10.082 12.1762L15.3521 9.40272C15.6372 9.25269 15.99 9.36215 16.14 9.64726C16.2901 9.93233 16.1806 10.2851 15.8955 10.4351L10.3568 13.3503C10.3458 13.3561 10.3346 13.3617 10.3233 13.3668L10.2934 13.3794L10.2422 13.3966L10.2196 13.4026L10.1801 13.4108L10.1301 13.4171L10.0926 13.419L10.0613 13.4187L10.0065 13.4141L9.97449 13.4091L9.9322 13.3995L9.89204 13.3872L9.85042 13.371L9.80775 13.3504L4.2688 10.4351C3.98371 10.2851 3.87423 9.93233 4.02428 9.64726C4.16718 9.37575 4.49394 9.26351 4.77101 9.38307ZM4.2688 13.0601L9.80775 15.9754L9.85042 15.996L9.89204 16.0122L9.9322 16.0245L9.97449 16.0341L10.0065 16.0391L10.0613 16.0437L10.0926 16.044L10.1301 16.0421L10.1801 16.0358L10.2196 16.0276L10.2422 16.0216L10.2934 16.0044L10.3233 15.9918C10.3346 15.9867 10.3458 15.9811 10.3568 15.9753L15.8955 13.0601C16.1806 12.9101 16.2901 12.5573 16.14 12.2723C15.99 11.9872 15.6372 11.8777 15.3521 12.0277L10.082 14.8012L4.81217 12.0277L4.77101 12.0081C4.49394 11.8885 4.16718 12.0007 4.02428 12.2723C3.87423 12.5573 3.98371 12.9101 4.2688 13.0601Z');
		titlebarInfoIconWrapperSvgIconPath.setAttribute('fill-rule', 'evenodd');
		titlebarInfoIconWrapperSvgIconPath.setAttribute('clip-rule', 'evenodd');

		titlebarInfoIconWrapperSvgMaskedGroup.appendChild(titlebarInfoIconWrapperSvgIconPath);

		titlebarInfoIconWrapperSvgG.appendChild(titlebarInfoIconWrapperSvgMask);
		titlebarInfoIconWrapperSvgG.appendChild(titlebarInfoIconWrapperSvgMaskedGroup);

		const titlebarInfoIconWrapperSvgDefs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
		const titlebarInfoIconWrapperSvgClipPath = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
		titlebarInfoIconWrapperSvgClipPath.setAttribute('id', 'clip0_1820_571926');

		const titlebarInfoIconWrapperSvgClipRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
		titlebarInfoIconWrapperSvgClipRect.setAttribute('width', '14');
		titlebarInfoIconWrapperSvgClipRect.setAttribute('height', '14');
		titlebarInfoIconWrapperSvgClipRect.setAttribute('fill', 'white');
		titlebarInfoIconWrapperSvgClipRect.setAttribute('transform', 'translate(3.08203 3)');

		titlebarInfoIconWrapperSvgClipPath.appendChild(titlebarInfoIconWrapperSvgClipRect);
		titlebarInfoIconWrapperSvgDefs.appendChild(titlebarInfoIconWrapperSvgClipPath);

		titlebarInfoIconWrapperSvg.appendChild(titlebarInfoIconWrapperSvgRect);
		titlebarInfoIconWrapperSvg.appendChild(titlebarInfoIconWrapperSvgG);
		titlebarInfoIconWrapperSvg.appendChild(titlebarInfoIconWrapperSvgDefs);

		container.appendChild(titlebarInfoIconWrapperSvg);
	}

	protected createChevronDownIcon(container: HTMLElement): void {
		/* CHEVRON DOWN ICON FOR DROPDOWN WRAPPER START */
		const titlebarInfoExpandedArrowWrapperSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		titlebarInfoExpandedArrowWrapperSvg.setAttribute('width', '14');
		titlebarInfoExpandedArrowWrapperSvg.setAttribute('height', '14');
		titlebarInfoExpandedArrowWrapperSvg.setAttribute('viewBox', '0 0 14 14');
		titlebarInfoExpandedArrowWrapperSvg.setAttribute('fill', 'none');
		titlebarInfoExpandedArrowWrapperSvg.setAttribute('style', 'transform: rotate(180deg)');

		const titlebarInfoExpandedArrowWrapperSvgPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		titlebarInfoExpandedArrowWrapperSvgPath.setAttribute('fill', '#737780');
		titlebarInfoExpandedArrowWrapperSvgPath.setAttribute('d', 'M9.47745 9.2686C9.70526 9.4964 10.0746 9.4964 10.3024 9.2686L10.7149 8.85613C10.9427 8.62831 10.9427 8.25897 10.7149 8.03116L7.41506 4.73133C7.30055 4.61682 7.15027 4.55986 7.00018 4.56048C6.8501 4.55986 6.69982 4.61682 6.58531 4.73133L3.28547 8.03116C3.05767 8.25897 3.05767 8.62831 3.28547 8.85612L3.69795 9.2686C3.92575 9.4964 4.29511 9.4964 4.52291 9.2686L7.00018 6.79132L9.47745 9.2686Z');
		titlebarInfoExpandedArrowWrapperSvgPath.setAttribute('fill-rule', 'evenodd');
		titlebarInfoExpandedArrowWrapperSvgPath.setAttribute('clip-rule', 'evenodd');

		titlebarInfoExpandedArrowWrapperSvg.appendChild(titlebarInfoExpandedArrowWrapperSvgPath);

		container.appendChild(titlebarInfoExpandedArrowWrapperSvg);
	}

	protected createFolderIcon(container: HTMLElement): void {
		// Create main SVG element
		const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.setAttribute('style', 'width: 14px;height: 14px;');
		svg.setAttribute('width', '18');
		svg.setAttribute('height', '18');
		svg.setAttribute('viewBox', '0 0 18 18');
		svg.setAttribute('fill', 'none');

		// Create the first path (folder bottom part)
		const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		path1.setAttribute('d', 'M2.24983 9.39366L1.23786 13.2051C0.896659 14.4902 1.86546 15.7498 3.19504 15.7498H13.9144C14.8326 15.7498 15.636 15.1319 15.8716 14.2444L17.1087 9.58474C17.3362 8.72804 16.6903 7.88831 15.804 7.88831H4.20702C3.28878 7.88831 2.48547 8.50617 2.24983 9.39366Z');
		path1.setAttribute('stroke', '#333940');
		path1.setAttribute('stroke-width', '1.4');
		path1.setAttribute('stroke-linecap', 'round');

		// Create the second path (folder top part)
		const path2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		path2.setAttribute('d', 'M16.0826 7.67158V6.30801C16.0826 5.18964 15.1759 4.28301 14.0576 4.28301H8.67248C8.2211 4.28301 7.7996 4.05743 7.54922 3.68186L6.99532 2.85103C6.74495 2.47546 6.32344 2.24988 5.87206 2.24988H3.19785C2.07948 2.24988 1.17285 3.1565 1.17285 4.27488V13.771');
		path2.setAttribute('stroke', '#333940');
		path2.setAttribute('stroke-width', '1.4');
		path2.setAttribute('stroke-linecap', 'round');

		// Add paths to SVG
		svg.appendChild(path1);
		svg.appendChild(path2);

		// Add to container
		container.appendChild(svg);
	}

	protected createGitBranchIcon(container: HTMLElement): void {
		// Create main SVG element
		const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.setAttribute('width', '14');
		svg.setAttribute('height', '14');
		svg.setAttribute('viewBox', '0 0 14 14');
		svg.setAttribute('fill', '#333940');
		svg.setAttribute('style', 'color:#9599A6');

		// Create the path for the git branch icon
		const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		path.setAttribute('fill-rule', 'evenodd');
		path.setAttribute('clip-rule', 'evenodd');
		path.setAttribute('d', 'M4.22929 3.88849L4.08366 3.97273V7.58362L4.5505 7.23298C5.23291 6.72037 6.08076 6.41675 7.00033 6.41675C8.38253 6.41675 9.53955 5.45553 9.84069 4.1654L9.8875 3.96482L9.71417 3.85361C9.30925 3.59385 9.04199 3.1406 9.04199 2.62508C9.04199 1.81967 9.69492 1.16675 10.5003 1.16675C11.3057 1.16675 11.9587 1.81967 11.9587 2.62508C11.9587 3.18179 11.6468 3.6661 11.1869 3.91206L11.0583 3.98086L11.0362 4.12501C10.7356 6.08346 9.04287 7.58341 7.00033 7.58341C5.61812 7.58341 4.4611 8.54463 4.15996 9.83476L4.11315 10.0353L4.28648 10.1466C4.6914 10.4063 4.95866 10.8596 4.95866 11.3751C4.95866 12.1805 4.30573 12.8334 3.50033 12.8334C2.69491 12.8334 2.04199 12.1805 2.04199 11.3751C2.04199 10.8357 2.33471 10.3643 2.77137 10.1117L2.91699 10.0274V3.97273L2.77137 3.88849C2.33471 3.63591 2.04199 3.16449 2.04199 2.62508C2.04199 1.81967 2.69491 1.16675 3.50033 1.16675C4.30573 1.16675 4.95866 1.81967 4.95866 2.62508C4.95866 3.16449 4.66594 3.63591 4.22929 3.88849Z');
		path.setAttribute('fill', '#333940');

		// Add path to SVG
		svg.appendChild(path);

		// Add to container
		container.appendChild(svg);
	}

	protected getRandomColor() {
		return `#${Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0')}`;
	}

	protected installMenubar(): void {
		if (this.menubar) {
			return; // If the menubar is already installed, skip
		}

		this.customMenubar = this._register(this.instantiationService.createInstance(CustomMenubarControl));

		// CUSTOM LEFT CONTENT START
		let toolbarContainer = this.leftContent.querySelector('.action-toolbar-container') as HTMLElement;
		if (!toolbarContainer) {
			toolbarContainer = document.createElement('div');
			toolbarContainer.classList.add('action-toolbar-container');
			this.leftContent.appendChild(toolbarContainer); // Append if not found
		}

		let nativeZydeLogo = toolbarContainer.querySelector('.native-zyde-logo') as HTMLElement;
		if (!nativeZydeLogo) {
			nativeZydeLogo = document.createElement('div');
			nativeZydeLogo.classList.add('native-zyde-logo');
			toolbarContainer.appendChild(nativeZydeLogo);
		}

		let menubarContainer = toolbarContainer.querySelector('.menubar-container') as HTMLElement;
		if (!menubarContainer) {
			menubarContainer = document.createElement('div');
			menubarContainer.classList.add('menubar-container');
			toolbarContainer.appendChild(menubarContainer);
		}

		let zydeTitleLeftMenuPadding = toolbarContainer.querySelector('.zyde-title-left-menu-padding') as HTMLElement;
		if (!zydeTitleLeftMenuPadding) {
			zydeTitleLeftMenuPadding = document.createElement('div');
			zydeTitleLeftMenuPadding.classList.add('zyde-title-left-menu-padding');
			toolbarContainer.appendChild(zydeTitleLeftMenuPadding);
		}

		let devSpaceTitlebarInfo = toolbarContainer.querySelector('.zyde-devspace-titlebar-info') as HTMLElement;
		if (!devSpaceTitlebarInfo) {
			devSpaceTitlebarInfo = document.createElement('div');
			devSpaceTitlebarInfo.classList.add('zyde-devspace-titlebar-info');
			toolbarContainer.appendChild(devSpaceTitlebarInfo);
		}

		devSpaceTitlebarInfo.addEventListener('click', () => {
			const zydeDevSpaceCard = toolbarContainer.querySelector('.devspace-card') as HTMLElement;
			if (zydeDevSpaceCard) {
				zydeDevSpaceCard.classList.toggle('show');
			}
		});

		let titlebarInfo = devSpaceTitlebarInfo.querySelector('.zyde-titlebar-info') as HTMLElement;
		if (!titlebarInfo) {
			titlebarInfo = document.createElement('div');
			titlebarInfo.classList.add('zyde-titlebar-info', 'desktop');
			devSpaceTitlebarInfo.appendChild(titlebarInfo);
		}

		let titlebarInfoIconWrapper = titlebarInfo.querySelector('.zyde-titlebar-info-icon-wrapper') as HTMLElement;
		if (!titlebarInfoIconWrapper) {
			titlebarInfoIconWrapper = document.createElement('div');
			titlebarInfoIconWrapper.classList.add('zyde-titlebar-info-icon-wrapper');
			titlebarInfo.appendChild(titlebarInfoIconWrapper);
		}

		this.createStackIcon(titlebarInfoIconWrapper);

		let titlebarInfoWorkspaceNameWrapper = titlebarInfo.querySelector('.zyde-titlebar-info-workspace-name-wrapper') as HTMLElement;
		if (!titlebarInfoWorkspaceNameWrapper) {
			titlebarInfoWorkspaceNameWrapper = document.createElement('div');
			titlebarInfoWorkspaceNameWrapper.classList.add('zyde-titlebar-info-workspace-name-wrapper');
			titlebarInfo.appendChild(titlebarInfoWorkspaceNameWrapper);
		}

		titlebarInfoWorkspaceNameWrapper.textContent = `Select Project`;

		let titlebarInfoExpandedArrowWrapper = titlebarInfo.querySelector('.zyde-titlebar-info-expanded-arrow-wrapper') as HTMLElement;
		if (!titlebarInfoExpandedArrowWrapper) {
			titlebarInfoExpandedArrowWrapper = document.createElement('div');
			titlebarInfoExpandedArrowWrapper.classList.add('zyde-titlebar-info-expanded-arrow-wrapper');
			titlebarInfo.appendChild(titlebarInfoExpandedArrowWrapper);
		}

		this.createChevronDownIcon(titlebarInfoExpandedArrowWrapper);

		let zydeDevSpaceTitlebarCard = toolbarContainer.querySelector('.zyde-devspace-titlebar-card') as HTMLElement;
		if (!zydeDevSpaceTitlebarCard) {
			zydeDevSpaceTitlebarCard = document.createElement('div');
			zydeDevSpaceTitlebarCard.classList.add('zyde-devspace-titlebar-card');
			toolbarContainer.appendChild(zydeDevSpaceTitlebarCard);
		}

		let devSpaceCard = zydeDevSpaceTitlebarCard.querySelector('.devspace-card') as HTMLElement;
		if (!devSpaceCard) {
			devSpaceCard = document.createElement('div');
			devSpaceCard.classList.add('devspace-card');
			devSpaceCard.style.left = '97px';
			zydeDevSpaceTitlebarCard.appendChild(devSpaceCard);
		}

		let devSpaceCardInnerWrapper = devSpaceCard.querySelector('.devspace-card-inner-wrapper') as HTMLElement;
		if (!devSpaceCardInnerWrapper) {
			devSpaceCardInnerWrapper = document.createElement('div');
			devSpaceCardInnerWrapper.classList.add('devspace-card-inner-wrapper');
			devSpaceCard.appendChild(devSpaceCardInnerWrapper);
		}

		let devSpaceProjectList = devSpaceCardInnerWrapper.querySelector('.devspace-project-list') as HTMLElement;
		if (!devSpaceProjectList) {
			devSpaceProjectList = document.createElement('div');
			devSpaceProjectList.classList.add('devspace-project-list');
			devSpaceCardInnerWrapper.appendChild(devSpaceProjectList);
		}

		let projectListContainer = devSpaceProjectList.querySelector('.project-list-container') as HTMLElement;
		if (!projectListContainer) {
			projectListContainer = document.createElement('div');
			projectListContainer.classList.add('project-list-container');
			projectListContainer.style.maxHeight = '1028px';
			devSpaceProjectList.appendChild(projectListContainer);
		}

		const commandService = this.instantiationService.invokeFunction(accessor => accessor.get(ICommandService));

		const workspaceService = this.instantiationService.invokeFunction(accessor => accessor.get(IWorkspacesService));

		workspaceService.getRecentlyOpened().then(recentlyOpened => {
			if (recentlyOpened && recentlyOpened.workspaces.length === 0) {
				// If there is no recent project, show the empty state
				let projectListContainerEmptyContent = projectListContainer.querySelector('.project-list-container-empty-content') as HTMLElement;
				if (!projectListContainerEmptyContent) {
					projectListContainerEmptyContent = document.createElement('div');
					projectListContainerEmptyContent.classList.add('project-list-container-empty-content');
					projectListContainer.appendChild(projectListContainerEmptyContent);
				}

				let openFolderButton = projectListContainerEmptyContent.querySelector('.open-folder-button') as HTMLElement;
				if (!openFolderButton) {
					openFolderButton = document.createElement('div');
					openFolderButton.classList.add('open-folder-button');
					projectListContainerEmptyContent.appendChild(openFolderButton);
				}

				let openFolderButtonIcon = openFolderButton.querySelector('.open-folder-button-icon') as HTMLElement;
				if (!openFolderButtonIcon) {
					openFolderButtonIcon = document.createElement('span');
					openFolderButtonIcon.classList.add('open-folder-button-icon');
					openFolderButton.appendChild(openFolderButtonIcon);

					this.createFolderIcon(openFolderButtonIcon);

					const openFolderText = document.createElement('span');
					openFolderText.innerText = 'Open Folder';
					openFolderButton.appendChild(openFolderText);
				}

				let cloneRepoButton = projectListContainerEmptyContent.querySelector('.clone-repo-button') as HTMLElement;
				if (!cloneRepoButton) {
					cloneRepoButton = document.createElement('div');
					cloneRepoButton.classList.add('clone-repo-button');
					projectListContainerEmptyContent.appendChild(cloneRepoButton);
				}

				let cloneRepoButtonIcon = cloneRepoButton.querySelector('.clone-repo-button-icon') as HTMLElement;
				if (!cloneRepoButtonIcon) {
					cloneRepoButtonIcon = document.createElement('span');
					cloneRepoButtonIcon.classList.add('clone-repo-button-icon');
					cloneRepoButton.appendChild(cloneRepoButtonIcon);

					this.createGitBranchIcon(cloneRepoButtonIcon);

					const cloneRepoText = document.createElement('span');
					cloneRepoText.innerText = 'Clone Repository';
					cloneRepoButton.appendChild(cloneRepoText);
				}

				openFolderButton.addEventListener('click', () => {
					commandService.executeCommand('workbench.action.files.openFileFolder');
				});

				cloneRepoButton.addEventListener('click', () => {
					commandService.executeCommand('git.clone');
				});
			} else {
				console.log(recentlyOpened.workspaces);
				// If there is recent project, show the project list
				let actionList = projectListContainer.querySelector('.action-list') as HTMLElement;
				if (!actionList) {
					actionList = document.createElement('div');
					actionList.classList.add('action-list');
					projectListContainer.appendChild(actionList);
				}

				let openFolderButton = actionList.querySelector('.open-folder-button') as HTMLElement;
				if (!openFolderButton) {
					openFolderButton = document.createElement('div');
					openFolderButton.classList.add('open-folder-button');
					actionList.appendChild(openFolderButton);
				}

				let openFolderButtonIcon = openFolderButton.querySelector('.open-folder-button-icon') as HTMLElement;
				if (!openFolderButtonIcon) {
					openFolderButtonIcon = document.createElement('span');
					openFolderButtonIcon.classList.add('open-folder-button-icon');
					openFolderButton.appendChild(openFolderButtonIcon);

					this.createFolderIcon(openFolderButtonIcon);

					const openFolderText = document.createElement('span');
					openFolderText.innerText = 'Open Folder';
					openFolderButton.appendChild(openFolderText);
				}

				let cloneRepoButton = actionList.querySelector('.clone-repo-button') as HTMLElement;
				if (!cloneRepoButton) {
					cloneRepoButton = document.createElement('div');
					cloneRepoButton.classList.add('clone-repo-button');
					actionList.appendChild(cloneRepoButton);
				}

				let cloneRepoButtonIcon = cloneRepoButton.querySelector('.clone-repo-button-icon') as HTMLElement;
				if (!cloneRepoButtonIcon) {
					cloneRepoButtonIcon = document.createElement('span');
					cloneRepoButtonIcon.classList.add('clone-repo-button-icon');
					cloneRepoButton.appendChild(cloneRepoButtonIcon);

					this.createGitBranchIcon(cloneRepoButtonIcon);

					const cloneRepoText = document.createElement('span');
					cloneRepoText.innerText = 'Clone Repository';
					cloneRepoButton.appendChild(cloneRepoText);
				}

				openFolderButton.addEventListener('click', () => {
					commandService.executeCommand('workbench.action.files.openFileFolder');
				});

				cloneRepoButton.addEventListener('click', () => {
					commandService.executeCommand('git.clone');
				});

				let header = projectListContainer.querySelector('.header') as HTMLElement;
				if (!header) {
					header = document.createElement('div');
					header.classList.add('header');
					header.classList.add('common-background');
					projectListContainer.appendChild(header);
				}

				let title = header.querySelector('.title') as HTMLElement;
				if (!title) {
					title = document.createElement('div');
					title.classList.add('title');
					title.innerText = 'Recent';
					header.appendChild(title);
				}

				let listContainer = projectListContainer.querySelector('.list-container') as HTMLElement;
				if (!listContainer) {
					listContainer = document.createElement('div');
					listContainer.classList.add('list-container');
					listContainer.classList.add('common-background');
					projectListContainer.appendChild(listContainer);
				}

				let projectList = listContainer.querySelector('.project-list') as HTMLElement;
				if (!projectList) {
					projectList = document.createElement('div');
					projectList.classList.add('project-list');
					listContainer.appendChild(projectList);
				}

				for (const workspace of recentlyOpened.workspaces) {
					console.log(workspace);

					let projectContainer = projectList.querySelector('.project-container') as HTMLElement;
					if (!projectContainer) {
						projectContainer = document.createElement('div');
						projectContainer.classList.add('project-container');
						projectList.appendChild(projectContainer);
					} else {
						projectContainer = document.createElement('div');
						projectContainer.classList.add('project-container');
						projectList.appendChild(projectContainer).cloneNode(true);
					}

					let zydeDevSpaceProjectThemeIcon = projectContainer.querySelector('.zyde-devspace-project-theme-icon') as HTMLElement;
					if (!zydeDevSpaceProjectThemeIcon) {
						zydeDevSpaceProjectThemeIcon = document.createElement('div');
						zydeDevSpaceProjectThemeIcon.classList.add('zyde-devspace-project-theme-icon');
						projectContainer.appendChild(zydeDevSpaceProjectThemeIcon);
					}

					let projectThemeIcon = zydeDevSpaceProjectThemeIcon.querySelector('.project-theme-icon') as HTMLElement;
					if (!projectThemeIcon) {
						projectThemeIcon = document.createElement('div');
						projectThemeIcon.classList.add('project-theme-icon');
						projectThemeIcon.style.backgroundColor = this.getRandomColor();
						zydeDevSpaceProjectThemeIcon.appendChild(projectThemeIcon);
					}

					let projectThemeIconText = projectThemeIcon.querySelector('.project-theme-icon-text') as HTMLElement;
					if (!projectThemeIconText) {
						projectThemeIconText = document.createElement('span');
						projectThemeIconText.classList.add('project-theme-icon-text');
						projectThemeIcon.style.paddingTop = '1px';
						if ('folderUri' in workspace) {
							projectThemeIconText.innerText = workspace.folderUri.path.split('/').pop()?.charAt(0) ?? '';
						}
						projectThemeIcon.appendChild(projectThemeIconText);
					}

					let projectInfo = projectContainer.querySelector('.project-info') as HTMLElement;
					if (!projectInfo) {
						projectInfo = document.createElement('div');
						projectInfo.classList.add('project-info');
						projectContainer.appendChild(projectInfo);
					}

					let projectNameOnlineText = projectInfo.querySelector('.project-name') as HTMLElement;
					if (!projectNameOnlineText) {
						projectNameOnlineText = document.createElement('div');
						projectNameOnlineText.classList.add('project-name');
						projectNameOnlineText.classList.add('oneline-text');
						if ('folderUri' in workspace) {
							projectNameOnlineText.innerText = workspace.folderUri.path.split('/').pop() ?? '';
						}
						projectInfo.appendChild(projectNameOnlineText);
					}

					let projectPath = projectInfo.querySelector('.project-path') as HTMLElement;
					if (!projectPath) {
						projectPath = document.createElement('div');
						projectPath.classList.add('project-path');
						projectInfo.appendChild(projectPath);
					}

					let container = projectPath.querySelector('.container') as HTMLElement;
					if (!container) {
						container = document.createElement('div');
						container.classList.add('container');
						projectPath.appendChild(container);
					}

					let measure = projectPath.querySelector('.measure') as HTMLElement;
					if (!measure) {
						measure = document.createElement('span');
						measure.classList.add('measure');
						if ('folderUri' in workspace) {
							measure.innerText = workspace.folderUri.path.replace(/^\/([a-z]):/, (_, drive) => drive.toUpperCase() + ':');
						}
						container.appendChild(measure);
					}

					let projectPathText = projectPath.querySelector('.project-path-text') as HTMLElement;
					if (!projectPathText) {
						projectPathText = document.createElement('span');
						projectPathText.classList.add('project-path-text');
						if ('folderUri' in workspace) {
							projectPathText.innerText = workspace.folderUri.path.replace(/^\/([a-z]):/, (_, drive) => drive.toUpperCase() + ':');
						}
						container.appendChild(projectPathText);
					}

					projectContainer.addEventListener('click', () => {
						if ('folderUri' in workspace) {
							commandService.executeCommand('vscode.openFolder', workspace.folderUri);
						}
					});
				}
				let bottomBlock = listContainer.querySelector('.bottom-block') as HTMLElement;
				if (!bottomBlock) {
					bottomBlock = document.createElement('div');
					bottomBlock.classList.add('bottom-block');
					bottomBlock.classList.add('common-background');
					listContainer.appendChild(bottomBlock);
				}
			}
		});

		let zydeTitleLeftCommandPadding = toolbarContainer.querySelector('.zyde-title-left-command-padding') as HTMLElement;
		if (!zydeTitleLeftCommandPadding) {
			zydeTitleLeftCommandPadding = document.createElement('div');
			zydeTitleLeftCommandPadding.classList.add('zyde-title-left-command-padding');
			toolbarContainer.appendChild(zydeTitleLeftCommandPadding);
		}

		let zydeCommandCenterTogglerWrapper = toolbarContainer.querySelector('.zyde-command-center-toggler-wrapper') as HTMLElement;
		if (!zydeCommandCenterTogglerWrapper) {
			zydeCommandCenterTogglerWrapper = document.createElement('div');
			zydeCommandCenterTogglerWrapper.classList.add('zyde-command-center-toggler-wrapper');
			toolbarContainer.appendChild(zydeCommandCenterTogglerWrapper);
		}

		let zydeCommandCenterButtonWrapper = zydeCommandCenterTogglerWrapper.querySelector('.zyde-command-center-button-wrapper') as HTMLElement;
		if (!zydeCommandCenterButtonWrapper) {
			zydeCommandCenterButtonWrapper = document.createElement('div');
			zydeCommandCenterButtonWrapper.classList.add('zyde-command-center-button-wrapper');
			zydeCommandCenterTogglerWrapper.appendChild(zydeCommandCenterButtonWrapper);
		}

		zydeCommandCenterButtonWrapper.addEventListener('click', () => {
			commandService.executeCommand('workbench.action.showCommands');
		});

		let zydeCommandCenterButtonIcon = zydeCommandCenterButtonWrapper.querySelector('.zyde-command-center-button-icon') as HTMLElement;
		if (!zydeCommandCenterButtonIcon) {
			zydeCommandCenterButtonIcon = document.createElement('div');
			zydeCommandCenterButtonIcon.classList.add('zyde-command-center-button-icon');
			zydeCommandCenterButtonIcon.classList.add('codicon');
			zydeCommandCenterButtonIcon.classList.add('codicon-search');
			zydeCommandCenterButtonWrapper.appendChild(zydeCommandCenterButtonIcon);
		}

		let zydeCommandCenterButtonText = zydeCommandCenterButtonWrapper.querySelector('.zyde-command-center-button-text') as HTMLElement;
		if (!zydeCommandCenterButtonText) {
			zydeCommandCenterButtonText = document.createElement('span');
			zydeCommandCenterButtonText.classList.add('zyde-command-center-button-text');
			zydeCommandCenterButtonText.innerText = 'Search';
			zydeCommandCenterButtonWrapper.appendChild(zydeCommandCenterButtonText);
		}

		let zydeTitleLeftDraggableArea = toolbarContainer.querySelector('.zyde-title-left-draggable-area') as HTMLElement;
		if (!zydeTitleLeftDraggableArea) {
			zydeTitleLeftDraggableArea = document.createElement('div');
			zydeTitleLeftDraggableArea.classList.add('zyde-title-left-draggable-area');
			toolbarContainer.appendChild(zydeTitleLeftDraggableArea);
		}
		// CUSTOM LEFT CONTENT END

		// CUSTOM CENTER CONTENT START
		let centerActionToolbarContainer = this.centerContent.querySelector('.action-toolbar-container') as HTMLElement;
		if (!centerActionToolbarContainer) {
			centerActionToolbarContainer = document.createElement('div');
			centerActionToolbarContainer.classList.add('action-toolbar-container');
			this.centerContent.appendChild(centerActionToolbarContainer);
		}

		let titleCenterLeftSlot = centerActionToolbarContainer.querySelector('.title-center-left-slot') as HTMLElement;
		if (!titleCenterLeftSlot) {
			titleCenterLeftSlot = document.createElement('div');
			titleCenterLeftSlot.classList.add('title-center-left-slot');
			centerActionToolbarContainer.appendChild(titleCenterLeftSlot);
		}

		let centerWindowTitle = centerActionToolbarContainer.querySelector('.window-title') as HTMLElement;
		if (!centerWindowTitle) {
			centerWindowTitle = document.createElement('div');
			centerWindowTitle.classList.add('window-title');
			centerActionToolbarContainer.appendChild(centerWindowTitle);
		}

		let titleCenterRightSlot = centerActionToolbarContainer.querySelector('.title-center-right-slot') as HTMLElement;
		if (!titleCenterRightSlot) {
			titleCenterRightSlot = document.createElement('div');
			titleCenterRightSlot.classList.add('title-center-right-slot');
			centerActionToolbarContainer.appendChild(titleCenterRightSlot);
		}

		let titleCenterRightSlot2 = centerActionToolbarContainer.querySelector('.title-center-right-slot2') as HTMLElement;
		if (!titleCenterRightSlot2) {
			titleCenterRightSlot2 = document.createElement('div');
			titleCenterRightSlot2.classList.add('title-center-right-slot2');
			centerActionToolbarContainer.appendChild(titleCenterRightSlot2);
		}
		// CUSTOM CENTER CONTENT END

		// Create the menubar
		this.menubar = document.createElement('div');
		this.menubar.classList.add('menubar', 'compact', 'inactive', 'overflow-menu-only'); // Add compact styles
		this.menubar.setAttribute('role', 'menubar');
		this.menubar.setAttribute('zyde-menubar-visibility', 'compact'); // Set visibility to compact mode

		// Append menubar inside the action-toolbar-container
		menubarContainer.appendChild(this.menubar);

		// Register visibility change listener
		this._register(this.customMenubar.onVisibilityChange(e => this.onMenubarVisibilityChanged(e)));

		// Create menubar inside the container
		this.customMenubar.create(this.menubar);
	}

	private uninstallMenubar(): void {
		this.customMenubar?.dispose();
		this.customMenubar = undefined;

		this.menubar?.remove();
		this.menubar = undefined;

		this.onMenubarVisibilityChanged(false);
	}

	protected onMenubarVisibilityChanged(visible: boolean): void {
		if (isWeb || isWindows || isLinux) {
			if (this.lastLayoutDimensions) {
				this.layout(this.lastLayoutDimensions.width, this.lastLayoutDimensions.height);
			}

			this._onMenubarVisibilityChange.fire(visible);
		}
	}

	updateProperties(properties: ITitleProperties): void {
		this.windowTitle.updateProperties(properties);
	}

	registerVariables(variables: ITitleVariable[]): void {
		this.windowTitle.registerVariables(variables);
	}

	protected override createContentArea(parent: HTMLElement): HTMLElement {
		this.element = parent;
		this.rootContainer = append(parent, $('.titlebar-container windows'));

		this.leftContent = append(this.rootContainer, $('.titlebar-left'));
		this.centerContent = append(this.rootContainer, $('.titlebar-center'));
		this.rightContent = append(this.rootContainer, $('.titlebar-right'));

		// App Icon (Windows, Linux)
		if ((isWindows || isLinux) && !hasNativeTitlebar(this.configurationService, this.titleBarStyle)) {
			this.appIcon = prepend(this.leftContent, $('a.window-appicon'));
		}

		// Draggable region that we can manipulate for #52522
		this.dragRegion = prepend(this.rootContainer, $('div.titlebar-drag-region'));

		// Menubar: install a custom menu bar depending on configuration
		if (
			!this.isAuxiliary &&
			!hasNativeTitlebar(this.configurationService, this.titleBarStyle) &&
			(!isMacintosh || isWeb) &&
			this.currentMenubarVisibility !== 'compact'
		) {
			this.installMenubar();
		}

		// Title
		this.title = append(this.centerContent, $('div.window-title'));
		this.createTitle();

		// Create Toolbar Actions
		if (hasCustomTitlebar(this.configurationService, this.titleBarStyle)) {
			this.actionToolBarElement = append(this.rightContent, $('div.action-toolbar-container'));
			this.createActionToolBar();
			this.createActionToolBarMenus();
		}

		// Window Controls Container
		if (!hasNativeTitlebar(this.configurationService, this.titleBarStyle)) {
			let primaryWindowControlsLocation = isMacintosh ? 'left' : 'right';
			if (isMacintosh && isNative) {

				// Check if the locale is RTL, macOS will move traffic lights in RTL locales
				// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Locale/textInfo

				const localeInfo = safeIntl.Locale(platformLocale) as any;
				if (localeInfo?.textInfo?.direction === 'rtl') {
					primaryWindowControlsLocation = 'right';
				}
			}

			if (isMacintosh && isNative && primaryWindowControlsLocation === 'left') {
				// macOS native: controls are on the left and the container is not needed to make room
				// for something, except for web where a custom menu being supported). not putting the
				// container helps with allowing to move the window when clicking very close to the
				// window control buttons.
			} else {
				const windowControlsContainer = append(primaryWindowControlsLocation === 'left' ? this.leftContent : this.rightContent, $('div.window-controls-container'));
				if (isWeb) {
					// Web: its possible to have control overlays on both sides, for example on macOS
					// with window controls on the left and PWA controls on the right.
					append(primaryWindowControlsLocation === 'left' ? this.rightContent : this.leftContent, $('div.window-controls-container'));
				}

				if (isWCOEnabled()) {
					windowControlsContainer.classList.add('wco-enabled');
				}
			}
		}

		// Context menu over title bar: depending on the OS and the location of the click this will either be
		// the overall context menu for the entire title bar or a specific title context menu.
		// Windows / Linux: we only support the overall context menu on the title bar
		// macOS: we support both the overall context menu and the title context menu.
		//        in addition, we allow Cmd+click to bring up the title context menu.
		{
			this._register(addDisposableListener(this.rootContainer, EventType.CONTEXT_MENU, e => {
				EventHelper.stop(e);

				let targetMenu: MenuId;
				if (isMacintosh && isHTMLElement(e.target) && isAncestor(e.target, this.title)) {
					targetMenu = MenuId.TitleBarTitleContext;
				} else {
					targetMenu = MenuId.TitleBarContext;
				}

				this.onContextMenu(e, targetMenu);
			}));

			if (isMacintosh) {
				this._register(addDisposableListener(this.title, EventType.MOUSE_DOWN, e => {
					if (e.metaKey) {
						EventHelper.stop(e, true /* stop bubbling to prevent command center from opening */);

						this.onContextMenu(e, MenuId.TitleBarTitleContext);
					}
				}, true /* capture phase to prevent command center from opening */));
			}
		}

		this.updateStyles();

		return this.element;
	}

	private createTitle(): void {
		this.titleDisposables.clear();

		// Text Title
		if (!this.isCommandCenterVisible) {
			this.title.innerText = this.windowTitle.value;
			this.titleDisposables.add(this.windowTitle.onDidChange(() => {
				this.title.innerText = this.windowTitle.value;
				// layout menubar and other renderings in the titlebar
				if (this.lastLayoutDimensions) {
					this.updateLayout(this.lastLayoutDimensions);
				}
			}));
		}

		// Menu Title
		else {
			const commandCenter = this.instantiationService.createInstance(CommandCenterControl, this.windowTitle, this.hoverDelegate);
			reset(this.title, commandCenter.element);
			this.titleDisposables.add(commandCenter);
		}
	}

	private actionViewItemProvider(action: IAction, options: IBaseActionViewItemOptions): IActionViewItem | undefined {

		// --- Activity Actions
		if (!this.isAuxiliary) {
			if (action.id === GLOBAL_ACTIVITY_ID) {
				return this.instantiationService.createInstance(SimpleGlobalActivityActionViewItem, { position: () => HoverPosition.BELOW }, options);
			}
			if (action.id === ACCOUNTS_ACTIVITY_ID) {
				return this.instantiationService.createInstance(SimpleAccountActivityActionViewItem, { position: () => HoverPosition.BELOW }, options);
			}
		}

		// --- Editor Actions
		const activeEditorPane = this.editorGroupsContainer.activeGroup?.activeEditorPane;
		if (activeEditorPane && activeEditorPane instanceof EditorPane) {
			const result = activeEditorPane.getActionViewItem(action, options);

			if (result) {
				return result;
			}
		}

		// Check extensions
		return createActionViewItem(this.instantiationService, action, { ...options, menuAsChild: false });
	}

	private getKeybinding(action: IAction): ResolvedKeybinding | undefined {
		const editorPaneAwareContextKeyService = this.editorGroupsContainer.activeGroup?.activeEditorPane?.scopedContextKeyService ?? this.contextKeyService;

		return this.keybindingService.lookupKeybinding(action.id, editorPaneAwareContextKeyService);
	}

	private createActionToolBar() {

		// Creates the action tool bar. Depends on the configuration of the title bar menus
		// Requires to be recreated whenever editor actions enablement changes

		this.actionToolBarDisposable.clear();

		this.actionToolBar = this.actionToolBarDisposable.add(this.instantiationService.createInstance(WorkbenchToolBar, this.actionToolBarElement, {
			contextMenu: MenuId.TitleBarContext,
			orientation: ActionsOrientation.HORIZONTAL,
			ariaLabel: localize('ariaLabelTitleActions', "Title actions"),
			getKeyBinding: action => this.getKeybinding(action),
			overflowBehavior: { maxItems: 9, exempted: [ACCOUNTS_ACTIVITY_ID, GLOBAL_ACTIVITY_ID, ...EDITOR_CORE_NAVIGATION_COMMANDS] },
			anchorAlignmentProvider: () => AnchorAlignment.RIGHT,
			telemetrySource: 'titlePart',
			highlightToggledItems: this.editorActionsEnabled, // Only show toggled state for editor actions (Layout actions are not shown as toggled)
			actionViewItemProvider: (action, options) => this.actionViewItemProvider(action, options),
			hoverDelegate: this.hoverDelegate
		}));

		if (this.editorActionsEnabled) {
			this.actionToolBarDisposable.add(this.editorGroupsContainer.onDidChangeActiveGroup(() => this.createActionToolBarMenus({ editorActions: true })));
		}
	}

	private createActionToolBarMenus(update: true | { editorActions?: boolean; layoutActions?: boolean; activityActions?: boolean } = true) {
		if (update === true) {
			update = { editorActions: true, layoutActions: true, activityActions: true };
		}

		const updateToolBarActions = () => {
			const actions: IToolbarActions = { primary: [], secondary: [] };

			// --- Editor Actions
			if (this.editorActionsEnabled) {
				this.editorActionsChangeDisposable.clear();

				const activeGroup = this.editorGroupsContainer.activeGroup;
				if (activeGroup) {
					const editorActions = activeGroup.createEditorActions(this.editorActionsChangeDisposable);

					actions.primary.push(...editorActions.actions.primary);
					actions.secondary.push(...editorActions.actions.secondary);

					this.editorActionsChangeDisposable.add(editorActions.onDidChange(() => updateToolBarActions()));
				}
			}

			// --- Global Actions
			const globalToolbarActions = this.globalToolbarMenu.getActions();
			this.hasGlobalToolbarEntries = globalToolbarActions.length > 0;
			fillInActionBarActions(
				globalToolbarActions,
				actions
			);

			// --- Layout Actions
			if (this.layoutToolbarMenu) {
				fillInActionBarActions(
					this.layoutToolbarMenu.getActions(),
					actions,
					() => !this.editorActionsEnabled // Layout Actions in overflow menu when editor actions enabled in title bar
				);
			}

			// --- Activity Actions (always at the end)
			if (this.activityActionsEnabled) {
				if (isAccountsActionVisible(this.storageService)) {
					actions.primary.push(ACCOUNTS_ACTIVITY_TILE_ACTION);
				}

				actions.primary.push(GLOBAL_ACTIVITY_TITLE_ACTION);
			}

			this.actionToolBar.setActions(prepareActions(actions.primary), prepareActions(actions.secondary));
		};

		// Create/Update the menus which should be in the title tool bar

		if (update.editorActions) {
			this.editorToolbarMenuDisposables.clear();

			// The editor toolbar menu is handled by the editor group so we do not need to manage it here.
			// However, depending on the active editor, we need to update the context and action runner of the toolbar menu.
			if (this.editorActionsEnabled && this.editorService.activeEditor !== undefined) {
				const context: IEditorCommandsContext = { groupId: this.editorGroupsContainer.activeGroup.id };

				this.actionToolBar.actionRunner = this.editorToolbarMenuDisposables.add(new EditorCommandsContextActionRunner(context));
				this.actionToolBar.context = context;
			} else {
				this.actionToolBar.actionRunner = this.editorToolbarMenuDisposables.add(new ActionRunner());
				this.actionToolBar.context = undefined;
			}
		}

		if (update.layoutActions) {
			this.layoutToolbarMenuDisposables.clear();

			if (this.layoutControlEnabled) {
				this.layoutToolbarMenu = this.menuService.createMenu(MenuId.LayoutControlMenu, this.contextKeyService);

				this.layoutToolbarMenuDisposables.add(this.layoutToolbarMenu);
				this.layoutToolbarMenuDisposables.add(this.layoutToolbarMenu.onDidChange(() => updateToolBarActions()));
			} else {
				this.layoutToolbarMenu = undefined;
			}
		}

		this.globalToolbarMenuDisposables.clear();
		this.globalToolbarMenuDisposables.add(this.globalToolbarMenu.onDidChange(() => updateToolBarActions()));

		if (update.activityActions) {
			this.activityToolbarDisposables.clear();
			if (this.activityActionsEnabled) {
				this.activityToolbarDisposables.add(this.storageService.onDidChangeValue(StorageScope.PROFILE, AccountsActivityActionViewItem.ACCOUNTS_VISIBILITY_PREFERENCE_KEY, this._store)(() => updateToolBarActions()));
			}
		}

		updateToolBarActions();
	}

	override updateStyles(): void {
		super.updateStyles();

		// Part container
		if (this.element) {
			if (this.isInactive) {
				this.element.classList.add('inactive');
			} else {
				this.element.classList.remove('inactive');
			}

			const titleBackground = this.getColor(this.isInactive ? TITLE_BAR_INACTIVE_BACKGROUND : TITLE_BAR_ACTIVE_BACKGROUND, (color, theme) => {
				// LCD Rendering Support: the title bar part is a defining its own GPU layer.
				// To benefit from LCD font rendering, we must ensure that we always set an
				// opaque background color. As such, we compute an opaque color given we know
				// the background color is the workbench background.
				return color.isOpaque() ? color : color.makeOpaque(WORKBENCH_BACKGROUND(theme));
			}) || '';
			this.element.style.backgroundColor = titleBackground;

			if (this.appIconBadge) {
				this.appIconBadge.style.backgroundColor = titleBackground;
			}

			if (titleBackground && Color.fromHex(titleBackground).isLighter()) {
				this.element.classList.add('light');
			} else {
				this.element.classList.remove('light');
			}

			const titleForeground = this.getColor(this.isInactive ? TITLE_BAR_INACTIVE_FOREGROUND : TITLE_BAR_ACTIVE_FOREGROUND);
			this.element.style.color = titleForeground || '';

			const titleBorder = this.getColor(TITLE_BAR_BORDER);
			this.element.style.borderBottom = titleBorder ? `1px solid ${titleBorder}` : '';
		}
	}

	protected onContextMenu(e: MouseEvent, menuId: MenuId): void {
		const event = new StandardMouseEvent(getWindow(this.element), e);

		// Show it
		this.contextMenuService.showContextMenu({
			getAnchor: () => event,
			menuId,
			contextKeyService: this.contextKeyService,
			domForShadowRoot: isMacintosh && isNative ? event.target : undefined
		});
	}

	protected get currentMenubarVisibility(): MenuBarVisibility {
		if (this.isAuxiliary) {
			return 'hidden';
		}

		return getMenuBarVisibility(this.configurationService);
	}

	private get layoutControlEnabled(): boolean {
		return !this.isAuxiliary && this.configurationService.getValue<boolean>(LayoutSettings.LAYOUT_ACTIONS) !== false;
	}

	protected get isCommandCenterVisible() {
		return this.configurationService.getValue<boolean>(LayoutSettings.COMMAND_CENTER) !== false;
	}

	private get editorActionsEnabled(): boolean {
		return this.editorGroupService.partOptions.editorActionsLocation === EditorActionsLocation.TITLEBAR ||
			(
				this.editorGroupService.partOptions.editorActionsLocation === EditorActionsLocation.DEFAULT &&
				this.editorGroupService.partOptions.showTabs === EditorTabsMode.NONE
			);
	}

	private get activityActionsEnabled(): boolean {
		const activityBarPosition = this.configurationService.getValue<ActivityBarPosition>(LayoutSettings.ACTIVITY_BAR_LOCATION);
		return !this.isAuxiliary && (activityBarPosition === ActivityBarPosition.TOP || activityBarPosition === ActivityBarPosition.BOTTOM);
	}

	get hasZoomableElements(): boolean {
		const hasMenubar = !(this.currentMenubarVisibility === 'hidden' || this.currentMenubarVisibility === 'compact' || (!isWeb && isMacintosh));
		const hasCommandCenter = this.isCommandCenterVisible;
		const hasToolBarActions = this.hasGlobalToolbarEntries || this.layoutControlEnabled || this.editorActionsEnabled || this.activityActionsEnabled;
		return hasMenubar || hasCommandCenter || hasToolBarActions;
	}

	get preventZoom(): boolean {
		// Prevent zooming behavior if any of the following conditions are met:
		// 1. Shrinking below the window control size (zoom < 1)
		// 2. No custom items are present in the title bar

		return getZoomFactor(getWindow(this.element)) < 1 || !this.hasZoomableElements;
	}

	override layout(width: number, height: number): void {
		this.updateLayout(new Dimension(width, height));

		super.layoutContents(width, height);
	}

	private updateLayout(dimension: Dimension): void {
		this.lastLayoutDimensions = dimension;

		if (hasCustomTitlebar(this.configurationService, this.titleBarStyle)) {
			const zoomFactor = getZoomFactor(getWindow(this.element));

			this.element.style.setProperty('--zoom-factor', zoomFactor.toString());
			this.rootContainer.classList.toggle('counter-zoom', this.preventZoom);

			if (this.customMenubar) {
				const menubarDimension = new Dimension(0, dimension.height);
				this.customMenubar.layout(menubarDimension);
			}
		}
	}

	focus(): void {
		if (this.customMenubar) {
			this.customMenubar.toggleFocus();
		} else {
			(this.element.querySelector('[tabindex]:not([tabindex="-1"])') as HTMLElement | null)?.focus();
		}
	}

	toJSON(): object {
		return {
			type: Parts.TITLEBAR_PART
		};
	}

	override dispose(): void {
		this._onWillDispose.fire();

		super.dispose();
	}
}

export class MainBrowserTitlebarPart extends BrowserTitlebarPart {

	constructor(
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IBrowserWorkbenchEnvironmentService environmentService: IBrowserWorkbenchEnvironmentService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IHostService hostService: IHostService,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@IEditorService editorService: IEditorService,
		@IMenuService menuService: IMenuService,
		@IKeybindingService keybindingService: IKeybindingService,
	) {
		super(Parts.TITLEBAR_PART, mainWindow, 'main', contextMenuService, configurationService, environmentService, instantiationService, themeService, storageService, layoutService, contextKeyService, hostService, editorGroupService, editorService, menuService, keybindingService);
	}
}

export interface IAuxiliaryTitlebarPart extends ITitlebarPart, IView {
	readonly container: HTMLElement;
	readonly height: number;
}

export class AuxiliaryBrowserTitlebarPart extends BrowserTitlebarPart implements IAuxiliaryTitlebarPart {

	private static COUNTER = 1;

	get height() { return this.minimumHeight; }

	constructor(
		readonly container: HTMLElement,
		editorGroupsContainer: IEditorGroupsContainer,
		private readonly mainTitlebar: BrowserTitlebarPart,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IBrowserWorkbenchEnvironmentService environmentService: IBrowserWorkbenchEnvironmentService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IHostService hostService: IHostService,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@IEditorService editorService: IEditorService,
		@IMenuService menuService: IMenuService,
		@IKeybindingService keybindingService: IKeybindingService,
	) {
		const id = AuxiliaryBrowserTitlebarPart.COUNTER++;
		super(`workbench.parts.auxiliaryTitle.${id}`, getWindow(container), editorGroupsContainer, contextMenuService, configurationService, environmentService, instantiationService, themeService, storageService, layoutService, contextKeyService, hostService, editorGroupService, editorService, menuService, keybindingService);
	}

	override get preventZoom(): boolean {

		// Prevent zooming behavior if any of the following conditions are met:
		// 1. Shrinking below the window control size (zoom < 1)
		// 2. No custom items are present in the main title bar
		// The auxiliary title bar never contains any zoomable items itself,
		// but we want to match the behavior of the main title bar.

		return getZoomFactor(getWindow(this.element)) < 1 || !this.mainTitlebar.hasZoomableElements;
	}
}
