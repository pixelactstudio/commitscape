# The Repo State and packs are read in place, and standard screens are stored

What a Build or the engine service reads from disk stays on disk: the Index's long columns, the commit graph, the Ownership of lines and a pack's columns are mapped and read in place rather than decoded onto the heap, and a cold Build lays its history out in files as it goes. Each head's standard screens are worked out once and stored with its Report.

## Status

accepted (2026-10-27). Amends ADR-0030, whose Repo State was decoded whole ("to be mapped in place"). Amends ADR-0028: packs are of format 3 and the engine service unpacks each once on its volume; the screens of the Windows all, 1y and 90d no longer come from the engine service.

## Context

The owner's target is a Build and an engine service that fit in about 250 MB, ideally 100 to 150 MB, on a two-core server. Measured on linux at the start of this work: a warm Build 600 to 885 MB of anonymous memory, a cold one 1.1 GB, everyone's Surviving Lines 1.6 GB, and the engine service 338 MB for one pack (580 MB while decoding it). The heap held what the files already held: the Index decoded whole, every git handle and thread with 50 to 190 MB of object and delta caches, the previous Ownership decoded beside the one being built, and every history walk's list of all commits.

## Decision

- **The Index's columns are kept beside the cache, laid out to be mapped.** Each cache generation has a column file (commits, changes, subjects, settled line marks) mapped copy-on-write by one small crate, the only code that maps memory. A warm Build maps it; a Build with new commits streams the old file and the new commits into the next one; the line pass counts only commits not settled and writes them back; a change in which files are left out masks only those files again. The file reads as absent until a save is on disk.
- **A cold Build goes through files.** The walk reads 32,768 commits at a time; the Index builder appends what it gathers to files in the cache folder and lays the columns out into files it maps; the cache's blocks are encoded one at a time as they are written.
- **The Ownership of lines is a file read in place,** commits sorted by id, files by path, each file's owners as varint runs; a new one is written file by file to disk and laid out at the end. Carried-over files copy their runs. A blame walk holds 16 MB of head text.
- **git's caches are small:** 1 to 8 MB per handle and thread. Speed is the same within noise, except a cold walk of linux (10% more wall time, the same CPU).
- **Packs are of format 3:** the bincode of everything but the long columns, then each column as zlib of its fixed records, compressed in R2 (3% larger than format 2). The engine service unpacks a pack once, streaming, into a page-aligned file on its volume and maps it; format 2 packs are still decoded. The engine service deploys before the Builder.
- **Standard screens are stored per head.** After publishing a pack, the Builder runs `commitscape screens` in a process of its own under an engine slot and stores the stats and the overview, activity, people and top of the map of all, 1y and 90d under the Report's prefix. The Site sends those first and asks the engine service only for the rest. A test checks every stored screen is the engine's own answer.

## Considered

- **Uncompressed columns in R2,** so the engine service maps what it downloads: linux's pack would grow from 103 MB to about 400 MB, four times the storage and transfer on a free tier, for a download that happens once per pack.
- **Working the screens out inside `build`:** one Window's shared answers cost about 170 MB on linux, which would have doubled the warm Build. A process of its own keeps each under its own budget.
- **Rollups per person and month,** so 1y and 90d slide by subtracting months: with the screens stored once per head, a page view no longer works anything out; rollups would make that once-per-head step cheaper and are left for later.

## Consequences

- linux, two threads: warm Build 94 MB, a Build 17,127 commits on 211 MB, cold without lines 276 MB, everyone's Surviving Lines from nothing 442 MB in 20 minutes (was 1.6 GB in about an hour), the engine service 117 MB after its first answer with 52 MB per pack on its heap; react under 160 MB for everything.
- The first Build of each repository after the upgrade writes its column file once (linux 13 s, 498 MB).
- The engine service's volume holds packs unpacked, about 2.6 times their R2 size; `PACK_DISK_GB` counts them so.
- A Report published before this release asks the engine service for its standard screens until its next Build.
- Still above 256 MB on linux: everyone's Surviving Lines (the blame walk's frontier) and the cold head pass (gix resolving 16 to 24 MB headers two at a time).
