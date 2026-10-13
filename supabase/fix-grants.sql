-- Fix: grant table permissions so RLS policies can be evaluated.
-- Without these, no role can access boards or board_items at all.

GRANT ALL ON public.boards TO authenticated;
GRANT ALL ON public.board_items TO authenticated;
GRANT SELECT ON public.boards TO anon;
GRANT SELECT ON public.board_items TO anon;

-- Service role bypasses RLS by default in Supabase, but needs table grants
GRANT ALL ON public.boards TO service_role;
GRANT ALL ON public.board_items TO service_role;

-- Also fix the existing tables if they have the same issue
GRANT ALL ON public.custom_tools TO authenticated;
GRANT ALL ON public.library_items TO authenticated;
GRANT SELECT ON public.custom_tools TO anon;
GRANT SELECT ON public.library_items TO anon;
GRANT ALL ON public.custom_tools TO service_role;
GRANT ALL ON public.library_items TO service_role;
