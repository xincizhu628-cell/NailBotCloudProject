# Template management

Official and community templates share `templates`, separated by `source_type`. Images are stored in `assets`; `gallery_templates` links them to `official_galleries` or `community_galleries`. No schema migration is required.

In admin.html, both libraries use the dedicated create/edit dialog. It edits names, descriptions, design attributes, categories, tags, author references, event, design JSON, visibility, status, publication date, gallery membership and 1–6 images. Existing values are loaded before editing; counters and creation timestamps are preserved. Images can be uploaded (PNG/JPEG/WEBP, 8 MB each) or supplied as HTTP(S) URLs. Removing a picture removes its template reference without deleting shared assets.

The session-authenticated `/api/admin/template-editor` endpoint accepts GET (source and optional id), POST (source, item), and PATCH (source, id, item). `templateAdminService` validates fields and references; `templateRepository` writes template, image and gallery changes in one transaction. Source-scoped reads and updates prevent accidentally editing the other library.

Admin lists include private and inactive templates; public listings still show only public, active templates. The existing customer publishing endpoint is unchanged.

Validation: `node --test tests/templateAdmin.test.js`; full admin-page browser checks exercise create and edit dialogs for both libraries with mocked API responses. Tests do not create production templates.
