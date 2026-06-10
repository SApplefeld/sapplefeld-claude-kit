# SQL Style — ASR.Eleos.Database.Deployment

This is the detailed pattern reference for writing SQL in Scott's style. The canonical examples come from `D:\source\repos\EleosCore\ASR.Eleos\ASR.Eleos.Database.Deployment`. When in doubt, open a sibling file in that library and follow its layout exactly.

## Table of contents

1. [Folder structure and file naming](#1-folder-structure-and-file-naming)
2. [Procedure deployment idiom](#2-procedure-deployment-idiom)
3. [Function deployment idiom](#3-function-deployment-idiom)
4. [Table deployment idiom](#4-table-deployment-idiom)
5. [Index deployment](#5-index-deployment)
6. [The procedure header banner](#6-the-procedure-header-banner)
7. [Parameter declarations](#7-parameter-declarations)
8. [SET statements](#8-set-statements)
9. [Variable declarations](#9-variable-declarations)
10. [Section banners inside a procedure](#10-section-banners-inside-a-procedure)
11. [TRY/CATCH and error logging](#11-trycatch-and-error-logging)
12. [Leading commas and tab alignment](#12-leading-commas-and-tab-alignment)
13. [SELECT, INSERT, UPDATE patterns](#13-select-insert-update-patterns)
14. [JOINs and CTEs](#14-joins-and-ctes)
15. [String, date, and null functions](#15-string-date-and-null-functions)
16. [Temp tables](#16-temp-tables)
17. [Comment styles](#17-comment-styles)
18. [Naming conventions](#18-naming-conventions)
19. [Full procedure template](#19-full-procedure-template)
20. [Full table template](#20-full-table-template)
21. [Full function template](#21-full-function-template)

---

## 1. Folder structure and file naming

The library uses numeric prefixes to enforce execution order during deployment:

| Folder | Contents | Why this number |
| --- | --- | --- |
| `0-Client` | Client-specific configuration, customization, and report jobs | Runs first — sets up environment-specific values |
| `3-Tables` | `CREATE TABLE` scripts with primary-key and index DDL | DDL must exist before procedures reference it |
| `4-Functions` | `udf_*` user-defined functions | Functions are dependencies of procedures |
| `5-Procedures` | `usp_*` stored procedures | Main business logic — runs after dependencies exist |
| `9-System` | System / TMS-specific procedures | Runs last; depends on full schema being present |
| `Database` | Bootstrap install scripts (TMWSuite, LoadMaster, TL2000) | One-time database creation scripts |

Folder gaps (1, 2, 6, 7, 8) are reserved for potential future categories — leave them open.

**File naming:** Each file is named `<schema>.<object>.sql`:
- `ELEOS.usp_GetBackgroundMessages.sql`
- `ELEOS.udf_DocumentFields.sql`
- `ELEOS.ApiCalls.sql` (tables omit a prefix)

Variant procedures use suffixes: `_Default`, `_Maintenance`, `_Trailers`, `_TMS`, `_Debug`, `_Custom_*`. Helper sub-procedures of a parent use `_Data`, `_Sort`, `_Stops`, `_Trips`.

## 2. Procedure deployment idiom

**Always shell-then-ALTER.** Never `CREATE OR ALTER PROCEDURE` — even though SQL Server supports it. The reason is that the shell-then-ALTER pattern preserves existing GRANTs and permissions across deployments.

The exact pattern:

```sql
-- CREATE A SHELL PROCEDURE IF NONE EXISTS.
;IF OBJECT_ID('ELEOS.usp_GetBackgroundMessages') IS NULL
  EXEC ('CREATE PROCEDURE ELEOS.usp_GetBackgroundMessages AS RETURN 0;')
GO

-- ALTER THE UPDATED PROCEDURE DEFINITION.
;ALTER PROCEDURE ELEOS.usp_GetBackgroundMessages
    -- ... parameters ...
WITH EXECUTE AS 'ELEOS'
AS
BEGIN	-- PROCEDURE
    -- ... body ...
END
GO
```

Key details:
- The shell `EXEC` line is indented 2 spaces (not a tab).
- `WITH EXECUTE AS 'ELEOS'` always appears before `AS`. This is the delegated security model — every proc runs as the schema owner.
- `BEGIN	-- PROCEDURE` has a tab between `BEGIN` and the trailing inline label comment. This is a signature pattern of Scott's style.
- The file ends with `GO` after the `END`.

## 3. Function deployment idiom

Functions use **drop-and-recreate** (different from procedures because functions can't be ALTERed in the same way and the drop-recreate is faster than the shell pattern):

```sql
;IF OBJECT_ID('ELEOS.udf_DocumentFields') IS NOT NULL
  EXEC ('DROP FUNCTION ELEOS.udf_DocumentFields;')
GO

;CREATE FUNCTION ELEOS.udf_DocumentFields
(
    -- ... parameters ...
)
RETURNS TABLE
WITH EXECUTE AS 'ELEOS'
AS
RETURN
(
    -- ... body ...
)
GO
```

For scalar functions, the `RETURN` is on its own line followed by the expression. For inline TVFs, `RETURN ( ... query ... )`.

## 4. Table deployment idiom

Tables use a **defensive existence check on `sys.schemas` joined to `sys.tables`** — not just `OBJECT_ID`. This is more readable in the diff and protects against name collisions across schemas.

```sql
/*********************************************************************************
	TABLE: ELEOS.ApiCalls
*********************************************************************************/
;IF NOT EXISTS(	SELECT	NULL
				FROM	sys.schemas S
						LEFT JOIN sys.tables T
							ON S.[schema_id] = T.[schema_id]
				WHERE	S.[name] = 'ELEOS'
						AND T.[name] = 'ApiCalls'  )
BEGIN 
	;CREATE TABLE ELEOS.ApiCalls (
		 [ApiCallId]				BIGINT			NOT NULL	IDENTITY(1,1)
		
		/* Request Fields */
		,[RequestMethod]			VARCHAR(50)		NOT NULL	DEFAULT('')	
		,[RequestUri]				VARCHAR(1000)	NOT NULL	DEFAULT('')
		,[RequestBody]				VARCHAR(MAX)	NOT NULL	DEFAULT('')
		,[RequestDt]				DATETIMEOFFSET	NULL	

		/* Response Fields */
		,[ResponseCode]				INT				NOT NULL	DEFAULT(0)
		,[ResponseBody]				VARCHAR(MAX)	NOT NULL	DEFAULT('')
		,[ResponseDt]				DATETIMEOFFSET	NULL

		/* Tracking Fields */
		,[ResponseTimeMs]			AS ( DATEDIFF(MILLISECOND, [RequestDt], [ResponseDt]) )	PERSISTED
		,[Completed]				BIT				NOT NULL	DEFAULT(0)	
		,[Cancelled]				BIT				NOT NULL	DEFAULT(0)

		/* Audit Fields */
		,[CreatedDt]				DATETIMEOFFSET	NOT NULL	DEFAULT(SYSDATETIMEOFFSET())
		,[UpdatedDt]				DATETIMEOFFSET	NOT NULL	DEFAULT(SYSDATETIMEOFFSET())

		-- PRIMARY KEY.
		,CONSTRAINT		PK_ApiCalls
						PRIMARY KEY	CLUSTERED	( [ApiCallId] )								
	) 
END	
GO
```

Key details:
- File starts with the `/* TABLE: <Name> */` banner comment.
- The `IF NOT EXISTS` block checks `sys.schemas` LEFT JOIN `sys.tables`.
- `BEGIN` and `END` wrap the `CREATE TABLE`.
- The `;CREATE TABLE` statement leads with semicolon.
- First column has a leading space before `[`, all subsequent columns have a leading comma.
- Columns are tab-aligned: name → type → nullability → default.
- `/* Group Name */` block comments group related columns (Request Fields, Response Fields, Tracking Fields, Error Fields, Audit Fields).
- A blank line between groups.
- **Audit fields** (`CreatedDt`, `UpdatedDt`) always go at the bottom, defaulted to `SYSDATETIMEOFFSET()` (not `GETDATE()`).
- Default constraints are inline `DEFAULT(...)` — not separately named.
- Computed columns use `AS ( expression ) PERSISTED`.
- The PK is the last entry, named `PK_<TableName>`, formatted with name on its own line and `PRIMARY KEY CLUSTERED ( [Col] )` indented underneath.

## 5. Index deployment

Indexes go in the same file as the table they support. Each index gets its own `IF NOT EXISTS` block:

```sql
-- Check for and Create IX_ApiCalls_RequestUriDate.
;IF NOT EXISTS(	SELECT	NULL
				FROM	sys.indexes I
				WHERE	I.[object_id] = OBJECT_ID('ELEOS.ApiCalls')
						AND I.[name] = 'IX_ApiCalls_RequestUriDate' )
BEGIN
	;CREATE NONCLUSTERED INDEX IX_ApiCalls_RequestUriDate
		ON ELEOS.ApiCalls (  [RequestUri]
							,[RequestDt]	)
END
GO
```

- Naming: `IX_<TableName>_<ColumnList>` (e.g. `IX_ApiCalls_RequestUriDate`).
- Each index check uses `sys.indexes` with `OBJECT_ID(...)` and `[name] = '...'`.
- Column list inside `( ... )` uses the leading-comma + tab alignment style.
- A short `-- Check for and Create <IndexName>.` comment introduces the block.

## 6. The procedure header banner

Inside `BEGIN -- PROCEDURE`, every procedure has a metadata banner. The banner is critical — it documents the purpose, author, version, and history. Skipping it is not an option.

The exact format:

```sql
    /********************************************************************************************
    *********************************************************************************************
        SCRIPT:		ELEOS.usp_GetBackgroundMessages
        AUTHOR:		Scott Applefeld
        DATE:		February 16th, 2025
        VERSION:	v1.0
    *********************************************************************************************
        NOTES:		v1.0 - 02/16/2025 - SCOTT APPLEFELD - ASR SOLUTIONS
                            Procedure to return background messages ready for re-processing into
                            the documents library or email outputs.
    *********************************************************************************************
    ********************************************************************************************/
```

Banner conventions:
- Top and bottom rows are 92 asterisks (or close — the count is by eye, not strict).
- Two adjacent asterisk lines bookend the SCRIPT/AUTHOR/DATE/VERSION block.
- One asterisk line separates the metadata from the NOTES section.
- DATE uses the **ordinal English format** ("February 16th, 2025", not "2025-02-16").
- Each NOTES entry leads with `vN.N - MM/DD/YYYY - AUTHOR NAME - COMPANY` then the body indented underneath.
- AUTHOR can be `Scott Applefeld` or `Scott Applefeld / ASR Solutions`.
- When you bump the version, **add** a new note line above the previous — do not rewrite history.

## 7. Parameter declarations

After the procedure name, parameters are declared inside parentheses (procedures only — older procs sometimes omit the parentheses). The first row inside is a comment row showing the column headings:

```sql
;ALTER PROCEDURE ELEOS.usp_AuditApiCall
(
    /*********************************************************************************************
     PARAMETER NAME		DATATYPE	        DEFAULT	   
    *********************************************************************************************/
     @p_ApiCallId       BIGINT              = NULL
    ,@p_RequestMethod   VARCHAR(50)		    = NULL
    ,@p_RequestUri      VARCHAR(1000)	    = NULL
    ,@p_RequestBody     VARCHAR(MAX)	    = NULL
    ,@p_RequestDt       DATETIMEOFFSET	    = NULL
    ,@p_ResponseCode    INT				    = NULL
)
WITH EXECUTE AS 'ELEOS'
AS
BEGIN	-- PROCEDURE
```

Conventions:
- **Parameter names use the `@p_` prefix** for input parameters (e.g. `@p_ApiCallId`).
- The first parameter has a leading space; subsequent parameters have a leading comma.
- Tab-align name column → type column → default column.
- Defaults: `= NULL` is the dominant default; `= 0` for counts/numerics; `= 1` for flags meaning "on".
- `OUTPUT` parameters are rare; when used they go at the end of the parameter list.
- Table-valued parameters use `READONLY`: `@p_FormData ELEOS.FormFieldType READONLY`.
- The closing `)` and the `WITH EXECUTE AS 'ELEOS'` are at the procedure-signature column.

For procedures that have no parameter wrapper (older style — see `usp_GetBackgroundMessages`), parameters appear directly after the procedure name with the same comment row, no parentheses, no `(`/`)`. Either style is acceptable; **match the surrounding files**.

## 8. SET statements

Every procedure body opens with two paired SET statements, inside their own banner section:

```sql
    /********************************************************************************************
        SET PROCESSING VARIABLES TO INCREASE SPEED AND DATA ACCESS.
    ********************************************************************************************/
    ;SET NOCOUNT ON
    ;SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED
```

- **`SET NOCOUNT ON`** is mandatory.
- **`SET TRANSACTION ISOLATION LEVEL`** is paired:
  - `READ UNCOMMITTED` for read-heavy procs (the default for `Get*` procedures)
  - `READ COMMITTED` for write/transactional procs (the default for `Save*`, `Process*`, audit procs)
- Both statements lead with a semicolon.
- They are wrapped in a section banner naming what they're for (the wording varies — "SET PROCESSING VARIABLES TO INCREASE SPEED AND DATA ACCESS." or "SET PROCESSING VARIABLES TO SUPPRESS OUTPUT.").

`SET XACT_ABORT` is **not used** in this codebase — error handling is via TRY/CATCH instead.

## 9. Variable declarations

Variables are declared in grouped `;DECLARE` blocks. Group by purpose; align tabs.

```sql
    /********************************************************************************************
        DECLARE VARIABLES FOR PROCESSING.
    ********************************************************************************************/				
    ;DECLARE @True						BIT				= 1
            ,@False						BIT				= 0
            ,@FieldName					VARCHAR(100)	= 'BackgroundStatus'
            ,@FieldValue				VARCHAR(100)	= 'ReProcessMessage'
```

Conventions:
- One `;DECLARE` keyword introduces the block; subsequent variables continue with leading comma.
- Tab-align name → type → default.
- `@True BIT = 1` and `@False BIT = 0` are declared at the top of nearly every procedure that has any conditional logic. Use them in place of literal `1`/`0` for readability.
- Variable names use plain `@PascalCase` — no `@v_` or `@local_` prefix conventions.
- `@p_` is reserved for parameters; never use `@p_` for local variables.
- When a procedure has many conceptually distinct variable groups, use multiple `;DECLARE` blocks with separate banners.

## 10. Section banners inside a procedure

Inside the body, every logical phase is introduced by a section banner. The standard phases (in order) for a typical procedure:

1. SET PROCESSING VARIABLES…
2. DECLARE VARIABLES FOR PROCESSING.
3. TEMPORARY TABLES (if needed)
4. RETRIEVE/POPULATE BASE DATA
5. VALIDATION / GUARD CHECKS
6. MAIN LOGIC (often subdivided by entity: `MESSAGE FIELDS`, `STOPS`, `TRIPS`, etc.)
7. OUTPUT RESULT SETS / DATASETS (often labeled `DATASET 1: ...`, `DATASET 2: ...`)
8. CLEANUP / FINALIZATION

Banner format:

```sql
    /********************************************************************************************
        DATASET 1: MESSAGE HEADER
    ********************************************************************************************/			
```

Banner-internal title is uppercase, ends with no period (banners are titles, not sentences). The banner asterisk lines are 92 characters wide. There is one leading space + tab indent inside the banner before the title.

For sub-sections inside a banner (smaller groupings), use a single-line `/* Sub-Section Title. */` block comment with a terminating period:

```sql
        /* Make Table to Track the Messages to Resend. */
        ;CREATE TABLE #ASR_ResendMessages (
```

## 11. TRY/CATCH and error logging

Every non-trivial procedure wraps its main logic in a `BEGIN TRY` / `BEGIN CATCH` block. The CATCH calls `usp_AuditError` to log the failure but does **not** re-throw — it absorbs the error so the caller doesn't fail.

```sql
    /********************************************************************************************
        UPSERT THE INFORMATION TO THE API CALLS TABLE.
    ********************************************************************************************/
    ;BEGIN TRY
        /* Validate Upsert Operation. */
        ;IF ( @p_ApiCallId > 0 )
        BEGIN
            /* Update the Existing Record. */
            ;UPDATE C   
            SET     [RequestMethod]     = COALESCE(@p_RequestMethod, C.[RequestMethod])
                    -- ...
            FROM    ELEOS.APICalls C
            WHERE   C.[ApiCallId] = @p_ApiCallId
        END ELSE BEGIN
            /* Insert a New Audit Record. */
            ;INSERT INTO ELEOS.APICalls ( ... )
            SELECT ...

            /* Get Identity for Insert. */
            ;SELECT  @p_ApiCallId = SCOPE_IDENTITY()
        END
    END TRY
    BEGIN CATCH
        /* Audit and Report Error. */
        ;IF ( OBJECT_ID('ELEOS.usp_AuditError') IS NOT NULL )
            EXECUTE ELEOS.usp_AuditError @p_ErrorData = @p_ApiCallId
    END CATCH
```

Key details:
- `;BEGIN TRY` and `END TRY` and `BEGIN CATCH` and `END CATCH` keywords on their own lines.
- The `IF (OBJECT_ID('ELEOS.usp_AuditError') IS NOT NULL)` guard is defensive — protects against deployments where the error logger isn't yet present.
- `END ELSE BEGIN` on a single line is a Scott signature pattern — note the spacing (one space on each side of `ELSE`).
- `THROW` may be used inside nested CATCHes when the error genuinely needs to propagate, but is rare.

## 12. Leading commas and tab alignment

The single most distinctive layout pattern. Apply it to:
- Parameter lists
- Variable declarations
- SELECT column lists
- INSERT column lists
- INSERT VALUES rows
- UPDATE SET clauses
- ORDER BY / GROUP BY / PARTITION BY clauses
- Temp table column lists
- Any list of items that wraps across lines

The pattern: **first item has a leading space; subsequent items have a leading comma**, and each comma sits in a column that aligns with the previous comma.

```sql
;SELECT	 [MessageId]            = M.[MessageId]
        ,[Handle]               = M.[Handle]
        ,[ThreadHandle]         = RTRIM(H.[ThreadHandle])
```

Tab characters do the alignment — not spaces. Inside this codebase one tab equals 4 columns of width.

For SQL Server bracket syntax, **always wrap column names in `[...]`** even when not necessary. This is for visual consistency.

## 13. SELECT, INSERT, UPDATE patterns

**Aliasing in SELECT:**
- Output columns always aliased with `[Alias] = expression` form (left-hand alias):
  ```sql
  SELECT   [DriverId]     = D.[Id]
          ,[FullName]     = CONCAT(D.[First], ' ', D.[Last])
  ```
- Tables in FROM/JOIN are aliased with a short identifier — no `AS`:
  ```sql
  FROM ELEOS.DocumentHistory H
       LEFT JOIN ELEOS.DocumentFields F
           ON H.[DocumentId] = F.[DocumentId]
  ```
- Aliases are usually single letters (`H`, `F`, `D`, `S`) but multi-letter mnemonics are fine when there's a collision (`LD` for Loads, `ST` for Stops).

**Never use `SELECT *`** in production SELECTs that return result sets to callers. SELECT * is allowed only for `SELECT * INTO #TempTable FROM ELEOS.udf_X(...)` cases where the source schema is controlled.

**INSERT:**

```sql
;INSERT INTO ELEOS.APICalls ( 
     [RequestMethod]
    ,[RequestUri]
    ,[RequestBody]
    ,[RequestDt]
    ,[CreatedDt]
    ,[UpdatedDt]                )
SELECT   [RequestMethod]    = COALESCE(@p_RequestMethod, '')
        ,[RequestUri]       = COALESCE(@p_RequestUri, '')
        ,[RequestBody]      = COALESCE(@p_RequestBody, '')
        ,[RequestDt]        = COALESCE(@p_RequestDt, NULL)
        ,[CreatedDt]        = SYSDATETIMEOFFSET()
        ,[UpdatedDt]        = SYSDATETIMEOFFSET()
```

- Closing `)` on the column list aligns to the right (after a tab).
- The SELECT below uses the same `[Alias] = value` form as a regular SELECT.

**UPDATE:**

```sql
;UPDATE C
SET      [RequestMethod]    = COALESCE(@p_RequestMethod, C.[RequestMethod])
        ,[RequestUri]       = COALESCE(@p_RequestUri, C.[RequestUri])
        ,[UpdatedDt]        = SYSDATETIMEOFFSET()
FROM    ELEOS.APICalls C
WHERE   C.[ApiCallId] = @p_ApiCallId
```

- `;UPDATE` lead with semicolon.
- `SET` keyword stands alone; first assignment has leading space.
- `FROM` and `WHERE` align with `SET`.

**Upsert pattern** (see `usp_AuditApiCall` for canonical example): `IF (@p_Id > 0) BEGIN /* update */ END ELSE BEGIN /* insert; SCOPE_IDENTITY() */ END`.

## 14. JOINs and CTEs

**JOINs:**
- `LEFT JOIN` (not `LEFT OUTER JOIN`), `INNER JOIN` (not just `JOIN`).
- Multi-condition `ON` clauses are wrapped in parentheses when clarity benefits, with `AND`s aligned:
  ```sql
  LEFT JOIN ELEOS.HCPEOPLE H
      ON  (    H.[Id] = TRY_PARSE(@p_UserName AS INT)
              AND H.[EmployeeStatusCode] = 'A' )
          OR  H.[DriverId] = @p_UserName
  ```
- **OUTER APPLY** is used freely for correlated subqueries (especially inside table-valued functions).

**CTEs:**
- Use `WITH cte<Name>` naming (`cteStopSequences`, `cteSearch`).
- Lead the WITH with `;WITH` (semicolon prefix).
- Each CTE body inside `( ... )` follows the standard SELECT layout.
- For chained CTEs, separate by `,` then a new `cte<Name> AS ( ... )`.
- Recursive CTEs are used freely when geographic/hierarchical traversal is needed.

## 15. String, date, and null functions

- **CONCAT** preferred over `+` for string concatenation — it's null-safe.
- **COALESCE** preferred over `ISNULL` for value defaulting (especially when there are 3+ fallbacks).
- **`IS NULL`** for existence checks in WHERE clauses.
- **TRY_PARSE / TRY_CONVERT** for safe casts (return NULL on failure).
- **FORMAT** for user-facing strings (`FORMAT(@OrderNumber, 'F0')`, `FORMAT(@Date, 'dddd, MMMM d, yyyy, h:mm tt')`).
- **CONVERT** for internal conversions (more performant than FORMAT).
- **SYSDATETIMEOFFSET()** for audit timestamps (preferred over `GETDATE()`).
- **GETDATE()** acceptable for transient/comparison logic where timezone doesn't matter.

## 16. Temp tables

- Use `#PascalCase` names (`#Loads`, `#Stops`, `#Parameters`, `#ASR_ResendMessages`).
- Always check existence before creating: `IF (OBJECT_ID('tempdb..#Name') IS NULL)`.
- Comment the purpose: `/* Make Table to Track the Messages to Resend. */`.
- For "shared" temp tables passed to nested EXEC calls, declare them in the outer procedure and rely on temp-table scoping.
- `SELECT INTO #Name FROM ...` is acceptable when you want to inherit schema from a function or query.

## 17. Comment styles

| Style | Use |
| --- | --- |
| `/********** TITLE **********/` (banner) | Major section dividers inside a procedure |
| `/* Sub-section Title. */` | Single-line block comments for smaller groupings; **end with period** |
| `/* Group Name */` (no period) | Group dividers inside a CREATE TABLE column list |
| `-- Comment.` | Inline comments and labels above blocks; **end with period** |
| `-- TITLE.` | Top-of-file pre-banner comments (e.g. `-- CREATE A SHELL PROCEDURE IF NONE EXISTS.`) |

The convention: **comments that are sentences end with a period; comments that are labels/titles do not.** Pay attention — the table column groups (`/* Request Fields */`) are titles and do not end in a period; the procedure inline comments (`/* Validate Upsert Operation. */`) are sentence-style instructions and do.

## 18. Naming conventions

| Object | Pattern | Example |
| --- | --- | --- |
| Schema | `ELEOS` (single schema) | `ELEOS.usp_GetLoads` |
| Table | PascalCase, no prefix | `ApiCalls`, `WorkflowReport` |
| Procedure | `usp_<PascalCase>` | `usp_GetBackgroundMessages` |
| Function | `udf_<PascalCase>` | `udf_DocumentFields` |
| Trigger / Job | `JOB.<schema>.<Name>` | `JOB.ELEOS.WorkflowReport` |
| Parameter | `@p_<PascalCase>` | `@p_ApiCallId` |
| Local variable | `@<PascalCase>` | `@DriverCode`, `@OrderNumber` |
| Boolean local | `@True`, `@False` (BIT 1, 0) | declared at top of procs that use them |
| Primary key | `PK_<TableName>` | `PK_ApiCalls` |
| Index | `IX_<TableName>_<ColList>` | `IX_ApiCalls_RequestUriDate` |
| Type | `ELEOS.<PascalCase>` | `ELEOS.FormFieldType` |
| Temp table | `#<PascalCase>` | `#Loads`, `#ASR_ResendMessages` |
| CTE | `cte<PascalCase>` | `cteStopSequences` |

**Procedure suffix conventions:**
- `_Default` — default variant (e.g. `usp_GetDocumentXML_Default`)
- `_Maintenance`, `_Trailers` — domain-specific variants
- `_TMS` — TMS-specific entry point (lives in `9-System/`)
- `_Debug` — debugging counterpart of a procedure
- `_Custom_<Vendor>` — client/vendor-specific custom processing

## 19. Full procedure template

When creating a new procedure in `5-Procedures/`, use this skeleton:

```sql
-- CREATE A SHELL PROCEDURE IF NONE EXISTS.
;IF OBJECT_ID('ELEOS.usp_DoSomething') IS NULL
  EXEC ('CREATE PROCEDURE ELEOS.usp_DoSomething AS RETURN 0;')
GO

-- ALTER THE UPDATED PROCEDURE DEFINITION.
;ALTER PROCEDURE ELEOS.usp_DoSomething
(
    /*********************************************************************************************
     PARAMETER NAME		DATATYPE		    DEFAULT
    *********************************************************************************************/
     @p_OrderNumber     INT                 = NULL
    ,@p_DriverCode      VARCHAR(50)         = NULL
)
WITH EXECUTE AS 'ELEOS'
AS
BEGIN	-- PROCEDURE

    /********************************************************************************************
    *********************************************************************************************
        SCRIPT:		ELEOS.usp_DoSomething
        AUTHOR:		Scott Applefeld
        DATE:		<Month DDth, YYYY>
        VERSION:	v1.0
    *********************************************************************************************
        NOTES:		v1.0 - <MM/DD/YYYY> - SCOTT APPLEFELD - ASR SOLUTIONS
                            <Description of what this procedure does and why it exists.>
    *********************************************************************************************
    ********************************************************************************************/
    
    /********************************************************************************************
        SET PROCESSING VARIABLES TO INCREASE SPEED AND DATA ACCESS.
    ********************************************************************************************/
    ;SET NOCOUNT ON
    ;SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED
    
    /********************************************************************************************
        DECLARE VARIABLES FOR PROCESSING.
    ********************************************************************************************/
    ;DECLARE @True						BIT				= 1
            ,@False						BIT				= 0

    /********************************************************************************************
        MAIN LOGIC.
    ********************************************************************************************/
    ;BEGIN TRY
        /* Describe what this block does. */
        ;SELECT  [SomeColumn] = T.[SomeColumn]
        FROM    ELEOS.SomeTable T
        WHERE   T.[OrderNumber] = @p_OrderNumber

    END TRY
    BEGIN CATCH
        /* Audit and Report Error. */
        ;IF ( OBJECT_ID('ELEOS.usp_AuditError') IS NOT NULL )
            EXECUTE ELEOS.usp_AuditError @p_ErrorData = @p_OrderNumber
    END CATCH
END
GO
```

## 20. Full table template

When creating a new table in `3-Tables/`, use this skeleton:

```sql
/*********************************************************************************
	TABLE: ELEOS.<TableName>
*********************************************************************************/
;IF NOT EXISTS(	SELECT	NULL
				FROM	sys.schemas S
						LEFT JOIN sys.tables T
							ON S.[schema_id] = T.[schema_id]
				WHERE	S.[name] = 'ELEOS'
						AND T.[name] = '<TableName>'  )
BEGIN 
	;CREATE TABLE ELEOS.<TableName> (
		 [<TableName>Id]			BIGINT			NOT NULL	IDENTITY(1,1)

		/* <Group 1 Name> */
		,[Column1]					VARCHAR(100)	NOT NULL	DEFAULT('')
		,[Column2]					INT				NOT NULL	DEFAULT(0)

		/* <Group 2 Name> */
		,[Column3]					DATETIMEOFFSET	NULL
		,[Column4]					BIT				NOT NULL	DEFAULT(0)

		/* Audit Fields */
		,[CreatedDt]				DATETIMEOFFSET	NOT NULL	DEFAULT(SYSDATETIMEOFFSET())
		,[UpdatedDt]				DATETIMEOFFSET	NOT NULL	DEFAULT(SYSDATETIMEOFFSET())

		-- PRIMARY KEY.
		,CONSTRAINT		PK_<TableName>
						PRIMARY KEY	CLUSTERED	( [<TableName>Id] )
	) 
END	
GO

-- Check for and Create IX_<TableName>_<ColList>.
;IF NOT EXISTS(	SELECT	NULL
				FROM	sys.indexes I
				WHERE	I.[object_id] = OBJECT_ID('ELEOS.<TableName>')
						AND I.[name] = 'IX_<TableName>_<ColList>' )
BEGIN
	;CREATE NONCLUSTERED INDEX IX_<TableName>_<ColList>
		ON ELEOS.<TableName> (  [Column1]
							   ,[Column2]	)
END
GO
```

## 21. Full function template

When creating a new inline TVF in `4-Functions/`, use this skeleton:

```sql
;IF OBJECT_ID('ELEOS.udf_DoSomething') IS NOT NULL
  EXEC ('DROP FUNCTION ELEOS.udf_DoSomething;')
GO

;CREATE FUNCTION ELEOS.udf_DoSomething
(
    @p_Param1   INT
)
RETURNS TABLE
WITH EXECUTE AS 'ELEOS'
AS
RETURN
(
    /********************************************************************************************
    *********************************************************************************************
        SCRIPT:		ELEOS.udf_DoSomething
        AUTHOR:		Scott Applefeld
        DATE:		<Month DDth, YYYY>
        VERSION:	v1.0
    *********************************************************************************************
        NOTES:		v1.0 - <MM/DD/YYYY> - SCOTT APPLEFELD - ASR SOLUTIONS
                            <Description.>
    *********************************************************************************************
    ********************************************************************************************/
    SELECT   [Column1] = T.[Column1]
            ,[Column2] = T.[Column2]
    FROM    ELEOS.SomeTable T
    WHERE   T.[Param1] = @p_Param1
)
GO
```

For scalar functions, replace `RETURNS TABLE ... RETURN ( SELECT ... )` with:

```sql
RETURNS VARCHAR(MAX)
WITH EXECUTE AS 'ELEOS'
AS
BEGIN
    DECLARE @Result VARCHAR(MAX) = ''
    -- ...
    RETURN @Result
END
```

When in doubt about a layout decision, **find a sibling file** in the same folder that solves a similar shape of problem and copy its layout exactly.
