# McPherson Sales-Slice Parity

Parity reports compare Meltano edge-runner evidence against the current
Fivetran path for a representative McPherson/JDE sales window. A report is not
complete until row counts, freshness, cursor/update behavior, late corrections,
delete/reversal behavior, schema drift, failed-run recovery, and downstream dbt
output are all represented.
