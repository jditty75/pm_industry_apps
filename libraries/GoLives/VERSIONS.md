# GoLives Version History

Track every immutable version cut from this library here.

| Version | Date | Changes | Cut By |
|---|---|---|---|
| 1 | (initial) | Initial version | Jeff |

## How to cut a new version
1. Make changes in src/
2. npm run push (pushes to HEAD for testing)
3. Test by temporarily pointing a consumer solution at HEAD
4. npm run version -- "Description of changes"
5. Add a row to this file with the new version number
6. Commit to Git
