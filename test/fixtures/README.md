# Share format fixtures

`v1/` is a copy of the app repo's `fixtures/share/v1/` (grahamegee/graft),
the contract in its `docs/share-format-v1.md`. Don't edit these here: change
them in the app repo and copy them across again.

To refresh, from this repo's root, with the app repo checked out beside it:

    rm -rf test/fixtures/v1
    cp -R ../graft/fixtures/share/v1 test/fixtures/v1
    node --test

Copied at graft commit 878d964.
