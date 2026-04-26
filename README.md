# Vault Outline

Vault Outline is an Obsidian plugin designed to provide a hierarchical, structured view of your notes based on intentional bulleted links.[cite: 2] It allows users to visualize and manage the relationship between "parent" notes and their "subnotes" through a dedicated sidebar view.[cite: 2]

## Key Features

*   **Dynamic Tree Extraction**: The plugin automatically builds an outline by following wikilinks formatted as bullet points.[cite: 2]
*   **Configurable Link Sources**: You can choose where the plugin searches for links:[cite: 2]
    *   **Comment Blocks**: Links hidden inside `%% ... %%` blocks.[cite: 2]
    *   **End of Document**: Links found in the final list block of a note.[cite: 2]
    *   **Under Heading**: Links located under a specific heading (e.g., "Subnotes").[cite: 2]
*   **Map-Based Rooting**: Notes tagged with `#mapa` are treated as roots, allowing the outline to maintain context even when navigating through subnotes.[cite: 2]
*   **Interactive Reorganization**:
    *   **Drag and Drop**: Move notes between parents or add new notes to the tree by dragging them directly within the view.[cite: 2]
    *   **Rearrange Modal**: Change the order of subnotes in the parent file using a dedicated UI.[cite: 2]
*   **Virtual Grouping**: Support for virtual nodes that act as organizational headers within the outline without requiring a physical file.[cite: 2]
*   **Visual Indexing**: Notes that are part of an outline tree are decorated with a checkmark icon in the standard Obsidian File Explorer.[cite: 2]
*   **Metadata Integration**: Quickly add `indexed` flags or specific tags (like `Definición`) to your notes through commands or context menus.[cite: 2]

## How It Works

The plugin's core logic is contained within the `src` directory, which handles the parsing of note content and the management of the tree state.[cite: 2] When a note is opened, the plugin traverses its links up to a defined maximum depth to render the structure.[cite: 2] 

The outline stays in sync with your vault by listening for file modifications and metadata changes, ensuring that renames and link updates are reflected immediately.[cite: 2]

## Commands

*   **Open vault outline**: Displays the outline view in the right sidebar.[cite: 2]
*   **Add indexed flag to active note**: Adds `indexed: true` to the frontmatter.[cite: 2]
*   **Add tag: Definición to active note**: Appends the `#Definición` tag to the note.[cite: 2]
*   **Rearrange subnotes of active note**: Opens the interface to reorder bulleted links in the current file.[cite: 2]
