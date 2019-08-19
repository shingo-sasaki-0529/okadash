const { shell } = require("electron");
var { remote } = require("electron");
var { isMac, app, Menu, MenuItem } = remote;
const fs = require("fs");
const Store = require("electron-store");
const store = new Store();
const json = loadSettings();
const menu = require("./menu");
let configWidth = json.contents[0].width;
let configHeight = json.contents[1].height;

// for xterm
const pty = require("node-pty");
const xtshell = process.env["SHELL"];
let ptyProcess = pty.spawn(xtshell, [], {
  cwd: process.cwd(),
  env: process.env
});
Terminal.applyAddon(fit);
fontSize = 12;
var xterm = new Terminal({
  fontSize: `${fontSize}`
});
xterm.isOpen = false;

initialize();

var dragging_vertical = false;
var dragging_horizontal = false;
var dragging_vertical_small = false;
var draggingId = "";
var smallWidth = 0;
$("#dragbar-vertical, .dragbar-vertical-small").mousedown(function(e) {
  e.preventDefault();
  $("#main-content").css("pointer-events", "none");
  if (this.id === "dragbar-vertical") {
    draggingId = "";
    dragging_vertical = true;
  } else {
    dragging_vertical_small = true;
    draggingId = this.id.replace(/[^0-9]/g, "");
    smallWidth =
      (document.getElementById(`${draggingId}`).clientWidth /
        document.getElementById("main-content").clientWidth) *
      100;
  }
  const main = $("#main-content");
  const ghostbar = $("<div>", {
    id: "ghostbar-vertical",
    css: {
      height: main.outerHeight(),
      top: main.offset().top,
      left: main.offset().left
    }
  }).appendTo("body");

  $(document).mousemove(function(e) {
    ghostbar.css("left", e.pageX + 2);
  });
});

$("#dragbar-horizontal").mousedown(function(e) {
  e.preventDefault();
  $("#main-content").css("pointer-events", "none");

  dragging_horizontal = true;
  const main = $(".medium");
  const ghostbar = $("<div>", {
    id: "ghostbar-horizontal",
    css: {
      width: main.outerWidth(),
      top: main.offset().top,
      left: main.offset().left
    }
  }).appendTo("body");

  $(document).mousemove(function(e) {
    ghostbar.css("top", e.pageY + 2);
  });
});

$(document).mouseup(function(e) {
  if (dragging_vertical) {
    $(".large").css("width", e.pageX + 2);
    $("#ghostbar-vertical").remove();
    $(document).unbind("mousemove");
    dragging_vertical = false;
  }
  if (dragging_horizontal) {
    $(".medium").css("height", e.pageY + 2);
    $("#ghostbar-horizontal").remove();
    $(document).unbind("mousemove");
    dragging_horizontal = false;
  }
  if (dragging_vertical_small) {
    const largeWidth = document.getElementById("0").clientWidth;
    const smallPanes = Array.from(document.getElementsByClassName("small"));
    var otherPanesLen = largeWidth;
    var nextPaneLen = largeWidth;

    // drop可能な範囲を限定
    smallPanes.forEach(function(pane) {
      if (pane.id < draggingId) otherPanesLen += pane.clientWidth;
      if (pane.id <= Number(draggingId) + 1) nextPaneLen += pane.clientWidth;
    });
    if (e.pageX <= otherPanesLen || e.pageX >= nextPaneLen) return;
    $(`#${draggingId}`).css("width", e.pageX - otherPanesLen);
    $(`#${Number(draggingId) + 1}`).css("width", nextPaneLen - e.pageX);

    $("#ghostbar-vertical").remove();
    $(document).unbind("mousemove");
    dragging_vertical_small = false;
  }
});

function initialize() {
  if (store.size == 0) return;

  initializeMenu(menu.menuTemplate);
  const contents = json.contents;
  contents.forEach(function(content) {
    createPane(content["size"], content["style"], content["url"]);
  });

  getWebviews().forEach(function(webview, index) {
    webview.addEventListener("dom-ready", function() {
      initializeWebview(webview);
      if (
        webview.parentNode.classList.contains("small") &&
        !webview.previousSibling.hasChildNodes()
      ) {
        addButtons(webview.previousSibling, webview.parentNode.id);
      }
    });
    webview.onresize = function() {
      const allWidth = document.getElementById("main-content").offsetWidth;
      const allHeight = document.getElementById("main-content").offsetHeight;
      const largeWidth = document.getElementsByClassName("large")[0]
        .offsetWidth;
      const mediumHheight = document.getElementsByClassName("medium")[0]
        .offsetHeight;
      configWidth = (largeWidth / allWidth) * 100;
      configHeight = (mediumHheight / allHeight) * 100;
      calcWindowSize();
    };
  });
}

function initializeMenu(template) {
  let menu = Menu.buildFromTemplate(template);
  const settingsMenu = createSettingsMenu();
  menu.append(settingsMenu);

  const menuItemForSmallPane = createMenuItemForSmallPane();
  menu.append(menuItemForSmallPane);

  Menu.setApplicationMenu(menu);
}

function createMenuItemForSmallPane() {
  const menuItem = new MenuItem({
    id: "smallPane",
    label: "Open",
    submenu: []
  });
  const nameAndUrls = getAdditionalPaneInfo(json.url_options);
  const additionalPaneMenuItems = createAdditionalPaneMenuItems(nameAndUrls);

  additionalPaneMenuItems.forEach(function(apMenuItem) {
    menuItem.submenu.append(apMenuItem);
  });
  return menuItem;
}

function createSettingsMenu() {
  const menuItem = new MenuItem({
    id: "settings",
    label: "Settings",
    submenu: [
      {
        label: "Reload",
        click() {
          store.clear();
          remote.getCurrentWindow().reload();
        }
      }
    ]
  });

  return menuItem;
}

function createAdditionalPaneMenuItems(nameAndUrls) {
  const additionalPaneMenuItems = nameAndUrls.map(function(nameAndUrl) {
    return new MenuItem({
      label: nameAndUrl["name"],
      accelerator: `Command+${nameAndUrl["index"] + 1}`,
      click() {
        loadAdditionalPage(nameAndUrl["url"]);
      }
    });
  });

  return additionalPaneMenuItems;
}

function getAdditionalPaneInfo(url_options) {
  const nameAndUrls = url_options.map(function(url, index) {
    let dispName = url.split("/").slice(-1)[0]; // 最後の / 以降を取得
    return { name: dispName, url: new URL(url), index: index };
  });
  return nameAndUrls;
}

function getWebviews() {
  let webviews = Array.from(document.getElementsByTagName("webview"));
  let xterm = Array.from(document.getElementsByClassName("terminal"));

  return webviews.concat(xterm);
}

function initializeWebview(webview, additionalPage = "") {
  renderByCustomCss(webview);
  registerToOpenUrl(webview, shell);
  webview.autosize = "on";

  if (webview.src === "about:blank") {
    if (additionalPage !== "") {
      webview.loadURL(additionalPage.toString());
    } else {
      webview.loadURL(webview.url.toString());
    }
  } else {
    addKeyEvents(webview);
  }
}

function renderByCustomCss(webview) {
  if (webview.id == "slack-only-body") {
    webview.insertCSS(getSlackOnlyBodyCss());
  } else if (webview.id == "slack-channel-and-body") {
    webview.insertCSS(getSlackChannelAndBodyCss());
  } else if (webview.id == "trello-headerless") {
    webview.insertCSS(getTrelloHeaderlessCss());
  }
}

function getSlackOnlyBodyCss() {
  return `.p-workspace__sidebar { display: none !important; }
    .p-classic_nav__team_header { display: none !important; }
    .p-workspace--context-pane-collapsed { grid-template-columns: 0px auto !important; }
    .p-workspace--classic-nav { grid-template-rows: min-content 60px auto !important; }
    .p-workspace--context-pane-expanded { grid-template-columns: 0px auto !important; }`;
}

function getSlackChannelAndBodyCss() {
  return `.p-channel_sidebar { width: 160px !important; }
    .p-classic_nav__team_header { display: none !important; }
    .p-workspace--context-pane-collapsed { grid-template-columns: 160px auto !important; }
    .p-workspace--classic-nav { grid-template-rows: min-content 60px auto !important; }
    .p-workspace--context-pane-expanded { grid-template-columns: 0px auto !important; }`;
}

function getTrelloHeaderlessCss() {
  return `#header { display: none !important; }
    .board-header { display: none !important; }
    .board-canvas { margin-top: 10px !important; }`;
}

function addKeyEvents(webview) {
  webview.getWebContents().on("before-input-event", (event, input) => {
    if (input.meta && input.key === "w") {
      if (webview.parentNode.classList.contains("small"))
        remove(webview.parentNode.id);
    }
  });
}

function remove(index) {
  draggingId = "";
  const target = document.getElementById(index);
  const targetBar = document.getElementById(`dvs-${index}`);
  const parent = target.parentNode;
  const smallPanes = Array.from(document.getElementsByClassName("small"));
  const bars = Array.from(
    document.getElementsByClassName("dragbar-vertical-small")
  );
  store.delete(`contents.${index}`);
  saveNewContents();

  smallPanes.forEach(function(pane) {
    if (pane.id > index) pane.id = pane.id - 1;
  });
  bars.forEach(function(bar) {
    id = Number(bar.id.replace(/[^0-9]/g, ""));
    if (id > index) {
      bar.id = `dvs-${id - 1}`;
      bar.style = `grid-column: ${(id - 1) * 2} / ${(id - 1) * 2 + 1}`;
    }
  });
  parent.removeChild(target);
  parent.removeChild(targetBar);
  calcWindowSize();
  refreshButtons();
}

function move(index, next) {
  const src = document.getElementById(index);
  const dst = document.getElementById(Number(index) + Number(next));
  const storeSrc = src.querySelector("webview");
  const storeDst = dst.querySelector("webview");
  storeStyle(dst.id, storeSrc.id);
  storeUrl(dst.id, storeSrc.src);
  storeStyle(src.id, storeDst.id);
  storeUrl(src.id, storeDst.src);
  const tmp = src.id;
  src.id = src.style.order = dst.id;
  dst.id = dst.style.order = tmp;
  refreshButtons();
}

function refreshButtons() {
  const main = document.getElementById("main-content");
  const panes = Array.from(main.children);
  panes.forEach(function(child) {
    if (!child.classList.contains("small")) return;
    const target = child.firstChild;
    if (target.nextSibling.classList.contains("terminal")) return;
    while (target.firstChild) {
      target.removeChild(target.firstChild);
    }
    addButtons(target, target.parentNode.id);
    child.style.width = "100%";
    child.style.height = "100%";
  });
}

function addButtons(div, index) {
  if (index != 2)
    div.innerHTML += `<button onclick=move(${index},"-1") style="font-size: 12px";><</button>`;
  div.innerHTML += `<button onclick=remove(${index}) style="font-size: 12px";>Close</button>`;
  if (index != getPaneNum() - 1)
    div.innerHTML += `<button onclick=move(${index},"1") style="font-size: 12px";>></button>`;
}

function getPaneNum() {
  return $(".large").length + $(".medium").length + $(".small").length;
}

function loadAdditionalPage(additionalPage) {
  resetWindowSize();
  if (additionalPage.href === "http://xterm/") {
    if (xterm.isOpen) return;
    var style = "xterm";
    const size = "small";
    createPane(size, style, "");
  } else {
    var style = "slack-only-body";
    const size = "small";
    createPane(size, style, "");
    storeStyle(getPaneNum() - 1, style);
    storeSize(getPaneNum() - 1, size);
    storeUrl(getPaneNum() - 1, additionalPage);

    const delta = xterm.isOpen ? 2 : 1;
    const webview = getWebviews()[getPaneNum() - delta];
    webview.addEventListener("dom-ready", function() {
      initializeWebview(webview, additionalPage);
    });
    refreshButtons();
  }
}

function storeStyle(index, style) {
  store.set(`contents.${index}.style`, style);
}

function storeSize(index, size) {
  store.set(`contents.${index}.size`, size);
}

function storeUrl(index, url) {
  store.set(`contents.${index}.url`, url);
}

function createPane(size, style, url = "") {
  let divContainer = createContainerDiv(size);
  let divButtons = createButtonDiv();

  document.getElementById("main-content").appendChild(divContainer);
  divContainer.appendChild(divButtons);
  if (style === "xterm") {
    createXtermPane();
  } else {
    const webview = createWebview(style, url);
    divContainer.appendChild(webview);
  }
  createDraggableBar(size);
  calcWindowSize();
}

function createXtermPane() {
  ptyProcess = pty.spawn(xtshell, [], {
    cwd: process.cwd(),
    env: process.env
  });
  xterm = new Terminal({
    fontSize: `${fontSize}`
  });
  xterm.open(document.getElementById(getPaneNum() - 1));
  xterm.isOpen = true;
  xterm.on("data", data => {
    ptyProcess.write(data);
    if (data === "") closeXtermPane(); // Ctrl+d
  });
  ptyProcess.on("data", function(data) {
    xterm.write(data);
  });
}

function closeXtermPane() {
  const target = document.getElementsByClassName("terminal")[0];
  remove(target.parentNode.id);
  xterm.isOpen = false;
}

function createDraggableBar(size) {
  let div = document.createElement("div");
  if (size === "large") {
    div.id = "dragbar-vertical";
  } else if (size === "medium") {
    div.id = "dragbar-horizontal";
  } else {
    div.id = `dvs-${getPaneNum() - 1}`;
    div.className = "dragbar-vertical-small";
    div.style = `grid-column: ${(getPaneNum() - 1) * 2} / 
      ${(getPaneNum() - 1) * 2 + 1}`;
  }
  document.getElementById("main-content").appendChild(div);
}

function createContainerDiv(size) {
  let div = document.createElement("div");
  div.id = getPaneNum();
  div.className = size;
  div.style.order = getPaneNum();
  return div;
}

function createButtonDiv() {
  let div = document.createElement("div");
  div.className = "tool-buttons";

  return div;
}

function createWebview(style, url = "") {
  let webview = document.createElement("webview");
  webview.src = "about:blank";
  webview.id = style;
  webview.url = url;
  return webview;
}

function registerToOpenUrl(webview, shell) {
  // Hack: remove EventListener if already added
  webview.removeEventListener("new-window", openExternalUrl);
  webview.addEventListener("new-window", openExternalUrl);
}

function openExternalUrl(event) {
  const url = event.url;
  if (
    url.startsWith("http://") ||
    url.startsWith("https://" || url.startsWith("file://"))
  ) {
    shell.openExternal(url);
  }
}

function openFileAndSave() {
  const win = remote.getCurrentWindow();
  remote.dialog.showOpenDialog(
    win,
    {
      properties: ["openFile"],
      filters: [
        {
          name: "config",
          extensions: ["json"]
        }
      ]
    },
    filePath => {
      if (filePath) {
        saveJson(filePath[0]);
      }
    }
  );
}

function saveJson(jsonPath) {
  const settings = JSON.parse(fs.readFileSync(jsonPath));
  store.set(settings);
  remote.getCurrentWindow().reload();
}

function loadSettings() {
  if (store.size == 0) {
    openFileAndSave();
    return;
  }

  return buildJsonObjectFromStoredData();
}

function saveNewContents() {
  const contents = store.get("contents");
  let newContents = [];
  contents.forEach(function(content) {
    if (content !== null) newContents.push(content);
  });
  store.set("contents", newContents);
}

function buildJsonObjectFromStoredData() {
  const contents = store.get("contents");
  let newContents = [];
  contents.forEach(function(content) {
    if (content !== null) newContents.push(content);
  });
  store.set("contents", newContents);
  let jsonObj = {
    url_options: store.get("url_options"),
    contents: newContents
  };

  return jsonObj;
}

function resetWindowSize() {
  const smallNum = document.getElementsByClassName("small").length;
  const main = document.getElementById("main-content");
  ratio =
    `${configWidth}% 0% ` +
    `${(100 - configWidth) / smallNum}% 0% `.repeat(smallNum);
  columns = `grid-template-columns: ${ratio} !important ;`;
  rows = `grid-template-rows: ${configHeight}% 0% ${100 -
    configHeight}% !important ;`;
  main.style = columns + rows;
  draggingId = "";
}

function calcWindowSize() {
  if (xterm.isOpen === true) xterm.fit();
  const smallNum = document.getElementsByClassName("small").length;
  const main = document.getElementById("main-content");
  let columns = "";
  let rows = "";
  if (smallNum !== 0) {
    const target = document.getElementById(`${draggingId}`);
    const next = document.getElementById(`${Number(draggingId) + 1}`);
    if (draggingId !== undefined && draggingId !== "") {
      let arColumns = main.style["grid-template-columns"].split(" ");
      var newSmallWidth = (target.clientWidth / main.clientWidth) * 100;
      var nextWidth = Math.abs(
        (next.clientWidth / main.clientWidth) * 100 +
          (smallWidth - newSmallWidth)
      );
      arColumns[Number(draggingId) * 2 - 2] = `${newSmallWidth}% `;
      arColumns[Number(draggingId) * 2] = `${nextWidth}% `;
      ratio = arColumns.join(" ");
      smallWidth = newSmallWidth;
    } else {
      ratio =
        `${configWidth}% 0% ` +
        `${(100 - configWidth) / smallNum}% 0% `.repeat(smallNum);
      const smallPanes = Array.from(document.getElementsByClassName("small"));
      smallPanes.forEach(function(pane) {
        pane.style.width = "100%";
        pane.style.height = "100%";
      });
    }
    columns = `grid-template-columns: ${ratio} !important ;`;
    rows = `grid-template-rows: ${configHeight}% 0% ${100 -
      configHeight}% !important ;`;
  } else {
    columns = `grid-template-columns: ${configWidth}% 0% ${100 -
      configWidth}% !important ;`;
    rows = `grid-template-rows: 99% 1% !important ;`;
  }
  main.style = columns + rows;
  if (configWidth !== undefined) {
    store.set("contents.1.height", configHeight);
    store.set("contents.0.width", configWidth);
  }
}
