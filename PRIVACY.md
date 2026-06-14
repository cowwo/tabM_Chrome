# Privacy Policy for Tab Sidebar (Chrome Extension)

**Last Updated:** June 14, 2026

## Overview

Tab Sidebar is a Chrome extension that displays your browser tabs in a side panel for easier management. This privacy policy explains what data the extension handles and how it is used.

## Data Collection

**This extension does not collect, transmit, or share any personal data.**

Specifically:

- **No analytics or tracking** — The extension does not use any analytics services, trackers, or telemetry.
- **No external servers** — The extension does not send any data to external servers or third-party services.
- **No user accounts** — The extension does not require or support user accounts.

## Data Stored Locally

The extension stores the following data **only on your device** using Chrome's `chrome.storage.local` API:

- **Extension settings** — Your preferences such as language, badge display, and tab display size.
- **Debug trace logs** — Optional verbose logging data, stored locally and only exported when you manually choose to do so.

This data never leaves your device. You can clear it at any time by uninstalling the extension or clearing Chrome's extension storage.

## Permissions Used

| Permission | Purpose |
|---|---|
| `tabs` | Read tab information (title, URL, favicon) to display in the side panel |
| `tabGroups` | Read and manage tab groups for display and organization |
| `sidePanel` | Show the tab management panel in Chrome's side panel |
| `favicon` | Display website icons next to tab entries |
| `storage` | Save your extension preferences locally |
| `alarms` | Keep the background service worker active for real-time tab updates |

## Third-Party Services

The extension does not integrate with any third-party services, SDKs, or APIs.

## Data Sharing

We do not sell, trade, or otherwise transfer any information to outside parties.

## Children's Privacy

This extension does not knowingly collect any data from anyone, including children under the age of 13.

## Changes to This Policy

If this privacy policy is updated, the changes will be reflected in this document with an updated "Last Updated" date.

## Contact

If you have any questions about this privacy policy, please open an issue on the project's GitHub repository.
