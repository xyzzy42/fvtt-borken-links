// Make a Table of things with broken Image links
// Author: Trent Piepho @xyzzy42
// Most things are clickable links, which will open the dialog where the link can be changed.
// The left column will open the actor/token/item/etc sheet, while the right will open a file
// picker to change the image directly.
//
// List of properties and way to locate them from Zhell's macros, https://github.com/krbz999/zhell-macros/blob/main/tools/image_migration_tool.js

const property = {
  "ActiveEffect": ["icon"],
  "Actor": ["img", "prototypeToken.texture.src"],
  "ActorDelta": ["img"],
  "Item": ["img"],
  "JournalEntry": [],
  "JournalEntryPage": ["src"],
  "Macro": ["img"],
  "Note": ["texture.src"],
  "RollTable": ["img"],
  "Scene": ["background.src", "foreground"],
  "TableResult": ["img"],
  "Tile": ["texture.src"],
  "Token": ["texture.src"],
};

// Find broken links in Document and also its embedded Collections
// Returns possibly empty array of {doc, path, value} objects.
async function findDoc(doc, params) {
  let broken = [];
  for (const [cls, name] of Object.entries(getDocumentClass(doc.documentName).metadata.embedded)) {
    const embCol = doc[name];
    broken = broken.concat(await findColl(embCol.map ? embCol : [embCol], params));
  }

  // Return update of document itself
  for (const path of property[doc.documentName] ?? []) {
    const value = foundry.utils.getProperty(doc, path);
    if (value && !(await fetch(value, {method: 'HEAD'}))?.ok) {
      broken.push({doc, path, value});
    }
  }
  return broken;
}

// Find links in all documents in Collection
async function findColl(collection, params) {
    return (await Promise.all(collection?.map?.(d => findDoc(d, params)) ?? [])).flat();
}

async function Find() {
  let broken = [];
  for (const docName in property) {
    const collection = game[getDocumentClass(docName).metadata.collection];
    if (collection) {
      broken = broken.concat(await findColl(collection, {}));
    }
  }
  return broken;
}

const broken = await Find();
console.log(broken); // So the documents can be inspected

let content = `
<script language="javascript">
function getUuid(e) { return e.closest("tr").dataset.uuid; }
async function showSheet(e) {
  const doc = await fromUuid(getUuid(e));
  doc.sheet.render(true);
}
async function showProto(e) {
  const doc = await fromUuid(getUuid(e));
  if (doc.token) return doc.token.sheet.render(true); // this is probably wrong
  else new CONFIG.Token.prototypeSheetClass(doc.prototypeToken).render(true);
}
async function fp(e, path) {
  const doc = await fromUuid(getUuid(e));
  const defimg = foundry.utils.getProperty(doc.constructor.getDefaultArtwork?.(doc), path);
  new FilePicker({
    current: foundry.utils.getProperty(doc, path),
    type: "image",
    allowUpload: true,
    redirectToRoot: defimg ? [defimg] : [],
    callback: async (file) => {
      const ok = fetch(file, {method: "HEAD"}).then(res => res?.ok);
      await doc.update({[path]: file});
      e.nextSibling.textContent = \` \${file}\`;
      e.closest('td').style['color'] = (await ok) ? "darkgreen" : "";
    },
  }).browse();
}
async function fpGroup(e, path) {
  const rows = e.closest("tr").querySelector('td:first-of-type > a').ariaControlsElements ?? [];
  new FilePicker({
    type: "image", allowUpload: true,
    current: e.nextSibling.textContent.slice(1),
    callback: async (file) => {
      const ok = fetch(file, {method: "HEAD"}).then(res => res?.ok);
      await Promise.all(rows.map(r => fromUuid(r.dataset.uuid).then(d => d.update({[path]: file}))));
      const color = (await ok) ? "darkgreen" : "";
      [e.closest('td'), ...rows.map(r => r.cells[1])].forEach(c => {
        c.lastChild.nodeValue = ' '+file;
        c.style['color'] = color;
      });
    }
  }).browse();
}
function toggle(e, entryIDs) {
  const tr = e.closest('tr');
  const exp = tr.getAttribute("aria-expanded") == 'true';
  const entries = document.querySelectorAll(entryIDs);
  if (exp) {
    [tr, ...entries].forEach(e => e.classList.add("collapsed"));
  } else {
    [tr, ...entries].forEach(e => e.classList.remove("collapsed"));
  }
  tr.setAttribute("aria-expanded", exp ? "false" : "true");
}
</script>
<style>
tr:not(:first-child) th {
  border-top: gray solid 1px;
  padding-top: 0.5em;
}
tr.entry.nested > td:first-of-type i {
  padding-left: 1em;
}
tr.entry.collapsed {
  visibility: collapse;
}
tr.folder.collapsed > td:first-child i::before {
  content: "\\f07b";
}
.window-content {
  scrollbar-gutter: stable;
}
</style>
<table>`;

function docLink(d, click, icon, toName=d => d.doc.name) {
  return `<tr data-uuid="${d.doc.uuid}"><td><a onclick="${click}(this)"><i class="fas ${icon}"></i> ${toName(d)}</a></td><td><a class="control" onclick="fp(this,'${d.path}')"><i class="fas fa-file-import"></i></a> ${d.value}</td></tr>`;
}

function docSheet(d, icon="fa-user-circle") { return docLink(d, 'showSheet', icon); }
function docProto(d) { return docLink(d, 'showProto', 'fa-user-circle'); }

function section(docs, name, link, toHtml) {
  if (docs.length) {
    content += `<tr><th>${name}</th><th>${link}</th></tr>`;
    content += docs.map(d => toHtml(d)).join("\n");
  }
}

function groupBy(iterable, func) {
  const m = new Map()
  for (i of iterable) {
    const k = JSON.stringify(func(i));
    if (!m.get(k)?.push?.(i)) m.set(k, [i]);
  }
  return new Map(Array.from(m, ([k, v]) => [JSON.parse(k), v]));
}

function tokenLink(d, nested) {
  return `<tr id="_${d.doc.id}" data-uuid="${d.doc.uuid}" class="entry ${nested ? "collapsed nested" : ""}"><td><a onclick="showSheet(this)"><i class="fas fa-user-circle"></i> ${d.doc.name}</a></td><td><a class="control" onclick="fp(this,'${d.path}')"><i class="fas fa-file-import"></i></a> ${d.value}</td></tr>`;
}

function sectionGrouped(docs, name, link) {
  if (!docs.length) return;

  content += `<tr><th>${name}</th><th>${link}</th></tr>`;

  const tokenGroups = groupBy(docs, t => ({name: t.doc.baseActor.name, value: t.value}));
  for (group of Array.from(tokenGroups.keys()).sort((a,b) => a.name.localeCompare(b.name))) {
    const tokens = tokenGroups.get(group);
    if (tokens.length > 1) {
      content += `
<tr class="folder collapsed" aria-expanded="false">
  <td><a onclick="toggle(this,'${tokens.map(t => '#_'+t.doc.id).join(",")}');" aria-controls="${tokens.map(t => "_"+t.doc.id).join(" ")}">
    <i class="fas fa-folder-open fa-fw"></i> ${group.name}</a></td>
  <td><a onclick="fpGroup(this, '${tokens[0].path}')"><i class="fas fa-file-import"></i></a> ${group.value}</td>
</tr>`;
    }
    content += tokens.map(d => tokenLink(d, tokens.length > 1)).join("\n");
  }
}

section(broken.filter(d => d.doc.documentName === "Actor" && d.path === 'img'),
  "Actor Portrait", "Borken Image Link", d => docSheet(d, 'fa-user'));
section(broken.filter(d => d.doc.documentName === "Actor" && d.path !== 'img'),
  "Actor Prototype Token", "Broken Image Lnk", docProto);
sectionGrouped(broken.filter(d => d.doc.documentName === "Token"),
               "Token", "Broken Iamge Link");
//section(broken.filter(d => d.doc.documentName === "Token").sort((a,b) => a.doc.baseActor.name.localeCompare(b.doc.baseActor.name)),
//  "Token", "Broken Iamge Link", d => docSheet(d));
section(broken.filter(d => d.doc.documentName === "Scene"),
  "Scenes", "Brkoen Image Link", d => docSheet(d, "fa-map"));
section(broken.filter(d => d.doc.documentName === "Tile"),
  "Tiles", "Broken Imge Link", d => docLink(d, "showSheet", "fa-cubes", d => d.doc.parent.name));
section(broken.filter(d => d.doc.documentName === "Item"),
  "Items", "Broken Image Lnik", d => docSheet(d, "fa-suitcase"));

const leftover = broken.filter(d => !["Actor", "Token", "Scene", "Item", "Tile"].includes(d.doc.documentName));
if (leftover.length) {
  content += `
<tr><th>Other Things</th></tr>
${leftover.map(d => `<tr><td>${d.doc.name ?? d.doc.id}</td><td>${d.value}</td></tr>`).join("\n")}
</table>
`;
}

new Dialog(
  {title: "Borken Links", content, buttons: {}, render: html => html.closest(".window-content").style["scrollbar-gutter"] = "stable"},
  {width:800, resizable: true, jQuery: false}).render(true);
