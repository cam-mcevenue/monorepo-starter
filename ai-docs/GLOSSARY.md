# Glossary

Terms shared across every domain in this repo. Each domain keeps its own terms in its own GLOSSARY.md.

## AI docs

**Domain**:
A top-level folder of `ai-docs/` holding one self-contained area of the repo, with its own router and glossary.
_Avoid_: workspace, area, section

**Codebase**:
The domain covering the repo's code, in `ai-docs/codebase/`. Issues with no domain label belong to it.

**Router**:
A folder's `ROUTER.md`, listing each of the folder's immediate children: what it holds and when to open it.
_Avoid_: index, README

**Glossary**:
A `GLOSSARY.md` defining the terms used in its scope: the repo root for shared terms, a domain for its own.
_Avoid_: dictionary

**ADR**:
An architecture decision record in an `_adrs/` folder: a decision that is hard to reverse, and why it was made.
_Avoid_: decision doc, design doc

## Issue tracking

**Spec**:
An issue labelled `spec` whose body describes a piece of work. Its tickets are its sub-issues.
_Avoid_: PRD, epic

**Ticket**:
A sub-issue of a spec or a wayfinder map, labelled and closed on its own. A spec's tickets slice its work; a map's are decision tickets.
_Avoid_: story
