---
name: sql-style
description: "My T-SQL house style. Use whenever writing or modifying ANY SQL: stored procedures, tables, functions, indexes, install or deployment scripts, or ad-hoc queries. Signature traits: shell-then-ALTER deployment, banner-comment headers, leading commas, tab-aligned columns, leading semicolons, audit-logging CATCH blocks that do not re-throw. Trigger on any SQL work even when style is not named."
---

# T-SQL Style

My personal SQL style. Internalize the philosophy, then consult [references/sql-style.md](references/sql-style.md) for the detailed pattern reference (all 21 sections: deployment idioms, banner formats, full procedure/table/function templates) before writing code.

## Core philosophy

1. **Idempotent and re-runnable by default.** Procedures use shell-then-ALTER (preserves GRANTs). Functions drop-and-recreate. Tables and indexes guard with IF NOT EXISTS. A deployment script never breaks on re-execution.
2. **Tab-aligned columns for related values.** Parameter lists, DECLARE blocks, column lists, SET clauses: names align, then types align, then defaults align. Non-negotiable.
3. **Leading commas, leading semicolons.** Commas start the continuation line so items line up. Statements lead with `;` to defend against missing terminators in the previous batch.
4. **Section banners over inline narration.** `/********** TITLE **********/` banners divide every procedure into named phases.
5. **Find a sibling and mimic it.** When in doubt, find an existing procedure/table solving a similar shape and copy its layout exactly. In greenfield repos, use the exemplar below and the full templates in the reference.

## Precedence

A repo's mechanically-enforced contract wins first: a committed formatter config, an `.editorconfig`, or a CI lint gate overrides this style, nothing softer does. Absent that, this style is the default authority. Philosophy point 5 (mimic a sibling) is for staying consistent inside a body of code already written in this style; a messy legacy sibling in a foreign repo is not a reason to drop the style.

## Exemplar (the deployment idiom and body skeleton)

The schema and the audit-logging proc below are placeholders (`<schema>`, `<schema_owner>`, `usp_LogError`). The pattern is what transfers: substitute the project's own schema and error-logging proc. `WITH EXECUTE AS` applies only where the project uses owner-impersonation; drop it where it does not.

```sql
-- CREATE A SHELL PROCEDURE IF NONE EXISTS.
;IF OBJECT_ID('<schema>.usp_DoSomething') IS NULL
  EXEC ('CREATE PROCEDURE <schema>.usp_DoSomething AS RETURN 0;')
GO

-- ALTER THE UPDATED PROCEDURE DEFINITION.
;ALTER PROCEDURE <schema>.usp_DoSomething
(
    /*********************************************************************************************
     PARAMETER NAME		DATATYPE		    DEFAULT
    *********************************************************************************************/
     @p_OrderNumber     INT                 = NULL
    ,@p_DriverCode      VARCHAR(50)         = NULL
)
WITH EXECUTE AS '<schema_owner>'
AS
BEGIN	-- PROCEDURE
    /* Banner header: SCRIPT / AUTHOR / DATE / VERSION / NOTES - see reference §6. */

    /********************************************************************************************
        SET PROCESSING VARIABLES TO INCREASE SPEED AND DATA ACCESS.
    ********************************************************************************************/
    ;SET NOCOUNT ON
    ;SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED

    ;BEGIN TRY
        /* Describe what this block does. */
        ;SELECT  [SomeColumn] = T.[SomeColumn]
        FROM    <schema>.SomeTable T
        WHERE   T.[OrderNumber] = @p_OrderNumber
    END TRY
    BEGIN CATCH
        /* Audit and Report Error. */
        ;IF ( OBJECT_ID('<schema>.usp_LogError') IS NOT NULL )
            EXECUTE <schema>.usp_LogError @p_ErrorData = @p_OrderNumber
    END CATCH
END
GO
```

## Antipatterns (common AI habits that violate the style)

- ❌ `CREATE OR ALTER PROCEDURE` - shell-then-ALTER, always (it preserves GRANTs)
- ❌ Trailing commas in any list - leading commas, always
- ❌ Lowercase keywords - UPPERCASE always
- ❌ Unbracketed columns - `[ColumnName]` always
- ❌ `RAISERROR` for routine errors - `EXECUTE <schema>.usp_LogError @p_ErrorData = ...` in CATCH, guarded by OBJECT_ID check
- ❌ Dynamic SQL built by string concatenation - inside a `WITH EXECUTE AS` procedure this is a privilege-escalation vector, not a style issue; where dynamic SQL is truly unavoidable, `sp_executesql` with typed parameters and a justifying comment
- ❌ Skipping `;SET NOCOUNT ON` + `;SET TRANSACTION ISOLATION LEVEL` - both required, paired, at the top
- ❌ Verbose multi-paragraph header comments - banner blocks with SCRIPT/AUTHOR/DATE/VERSION/NOTES only
- ❌ Change-narrative comments ("Updated to...", "fixed the...", "per the new spec") - the doctrine's current-state rule applies: a comment or banner states what the code does now, never the session, the change, or the prior version
- ❌ `GETDATE()` for audit timestamps - `SYSDATETIMEOFFSET()`
- ❌ Right-hand aliases (`expr AS Alias`) in SELECT - left-hand form: `[Alias] = expression`
- ❌ `SELECT *` in result sets returned to callers

## Checklist before declaring SQL work complete

- [ ] Procs: shell-then-ALTER; functions: drop-and-recreate; tables/indexes: IF NOT EXISTS guards
- [ ] `WITH EXECUTE AS '<schema_owner>'` on procs and scalar/multi-statement functions where the codebase uses impersonation (never on inline TVFs; dropped entirely where the codebase does not impersonate)
- [ ] Banner header: SCRIPT / AUTHOR / DATE (ordinal English) / VERSION / NOTES; new versions ADD a note line, never rewrite history
- [ ] `BEGIN	-- PROCEDURE` with tab + trailing label after `AS`
- [ ] `;SET NOCOUNT ON` paired with isolation level (`READ UNCOMMITTED` for Get*, `READ COMMITTED` for writes)
- [ ] Statements lead with `;`; parameters use `@p_` prefix; locals plain `@PascalCase`; `@True`/`@False` BIT pair when conditionals exist
- [ ] Leading commas + tab alignment in every multi-line list; first item gets a leading space
- [ ] Section banners divide logic into phases; `/* Sub-Section. */` comments end with a period; group labels do not
- [ ] Tables: `/* Group Name */` column groups, audit fields (CreatedDt/UpdatedDt, SYSDATETIMEOFFSET defaults) at the bottom, `PK_<Table>` last
- [ ] Indexes: `IX_<Table>_<Cols>`, own IF NOT EXISTS block, in the table's file
- [ ] TRY/CATCH wraps main logic; CATCH audits via the project's error-logging proc and does not re-throw
- [ ] File ends with `GO`
