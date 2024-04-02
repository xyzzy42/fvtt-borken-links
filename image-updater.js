// Replace Image Links.
// Author: Trent Piepho
//
// Inspired by Zhell's macro at https://github.com/krbz999/zhell-macros/blob/main/tools/image_migration_tool.js
// Never would have figured out the way through these twisty little data structures without it.
//
// Has various options, but mainly it uses a list of image extensions and searches the server
// for the first one in the list that exists for each image link to be replaced.  If the files
// aren't there, it doesn't change the link.
//
// Can exclude images from game systems, modules, and/or Foundry itself, since they get replaced
// on updates.
//
// The server checks are done in parallel and use HEAD requests to only check if the image
// exists, without downloading it, so it's pretty fast.


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

// Create an update for a single document.
// Returns [] if there is no update.
async function doDocUpdate(doc, params) {
  // Update all of the embedded collections in the document
  for (const [cls, name] of Object.entries(getDocumentClass(doc.documentName).metadata.embedded)) {
    if (!params.change.get(cls)) continue;
    const embCol = doc[name];
    const updates = await doColUpdate(embCol.map ? embCol : [embCol], params);
    if (updates.length) {
      console.log(`Update embedded ${doc.name}.${name}:`, updates);
      // await doc.updateEmbeddedDocuments(name, updates);
    }
  }

  // Return update of document itself
  let update = {};
  for (const path of property[doc.documentName]) {
    const value = foundry.utils.getProperty(doc, path);
    if (value && 
      (params.replaceSystem || !value.startsWith('systems/')) &&
      (params.replaceModule || !value.startsWith('modules/')) &&
      (params.replaceFoundry || (!value.startsWith('ui/') && !value.startsWith('icons/')))
    ) {
      const split = value.lastIndexOf(".") >>> 0;
      const base = value.slice(0, split);
      const ending = value.slice(split+1);
      if (params.exclude.includes(ending)) continue;

      let toTry = params.endings.indexOf(ending);
      if (toTry == -1) toTry = params.endings.length;

      for (let i = 0; i < toTry; i++) {
        const name = `${base}.${params.endings[i]}`;
        if ((await fetch(name, {method: "HEAD"}))?.ok) {
	  //console.log(`Change ${path} to ${name}`);
	  foundry.utils.setProperty(update, path, name);
	  break;
	}
      }
    }
  }
  if (Object.keys(update).length) {
    update._id = doc.id;
    return update;
  }
  return [];
}

// Return array of update for all documents in collection
async function doColUpdate(collection, params) {
    return (await Promise.all(collection?.map?.(d => doDocUpdate(d, params)) ?? [])).flat();
}

async function doRename(html) {
  const params = {
    replaceSystem: html.find("#replacesystem")[0].checked,
    replaceModule: html.find("#replacemodule")[0].checked,
    replaceFoundry: html.find("#replacefoundry")[0].checked,
    endings: html.find("#endings")[0].value.match(/\S+/g),
    exclude: html.find("#exclude")[0].value.match(/\S+/g) ?? [],
    change: new Map(Object.keys(property).map(k => [k, html.find('#' + k)[0].checked])),
  };

  for (const docName in property) {
    if (!params.change.get(docName)) continue;
    const collection = game[getDocumentClass(docName).metadata.collection];
    if (collection) {
      const updates = await doColUpdate(collection, params);
      if (updates.length) {
	console.log(`Collection ${docName}, updates:`, updates);
	//await collection.documentClass.updateDocuments(updates);
      }
    }
  }
}


// There's probably some kind of CSS flex thing to do this automatically
function checkBoxes() {
  const checks = Object.keys(property).map(k => `<td><input type="checkbox" id="${k}" checked />${k}</td>`);
  let html = "";
  for(let i = 0; i < checks.length; i += 2) {
    html += `<tr>${checks[i]} ${checks[i+1] ?? ""}</tr>`;
  }
  return html;
}

let content = `
<p>The supplied list of extensions will be tried, in order, for the first file that exists on
the server and then updated to that new link.  If there isn't a file with a "better" image type
on the server, the link isn't updated.  So this won't produce any broken links.<br>
Files with certain extensions can be skipped.<br>
It's also possible to skip links that point to assets that are part of a Game System, Module,
or Foundry. 
</p>
<table style="width:100%; text-align:left;">
<th>Document types to replace images in:</th>
${checkBoxes()}
</table>
Extensions(s) to try: <input id="endings" type="string" style="width: 150px;" value="avif webp jpg"> <br>
Exclude these extension(s): <input id="exclude" type="string" style="width: 150px;" value="svg"> <br>
Replace Foundry images: <input type="checkbox" id="replacefoundry" /> <br>
Replace system images: <input type="checkbox" id="replacesystem" /> <br>
Replace module images: <input type="checkbox" id="replacemodule" />
`;

new Dialog({
  title: "Rename Images",
  content,
  buttons: {
    ok: {
      label: "Apply",
      callback: doRename,
    },
    cancel: {
      label: "Cancel",
    },
  }},
  { width: 400 }
).render(true);
