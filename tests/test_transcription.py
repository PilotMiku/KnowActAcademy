"""Checks that transcription comparison does not lose mathematical meaning."""
import importlib.util
from pathlib import Path
import unittest
import sys
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'experiments/pdf-documents'))


def module(name):
    spec=importlib.util.spec_from_file_location(name,ROOT/'experiments/pdf-documents'/(name+'.py'))
    loaded=importlib.util.module_from_spec(spec);spec.loader.exec_module(loaded)
    return loaded


comparison=module('compare_versions')
assembly=module('assemble')
normalization=module('latex_normalization')


class MathematicalComparisonTests(unittest.TestCase):
    def test_legacy_root_normalization_retains_radicand_scope(self):
        self.assertEqual(normalization.normalize(r'\root 3 \of {x+1}+y'),r'\sqrt[3]{x+1}+y')
        self.assertEqual(normalization.normalize(r'\root n \of x+y'),r'\sqrt[n]{x}+y')
        self.assertEqual(normalization.normalize(r'\root 3 \of {x'),r'\root 3 \of {x')
        self.assertEqual(normalization.normalize(r'\root n \of {\root 3 \of {x}}'),r'\sqrt[n]{\sqrt[3]{x}}')

    def tree(self,value):
        return comparison.canonical(ET.fromstring('<math>'+value+'</math>'))

    def test_group_wrappers_and_print_styles_do_not_change_content(self):
        self.assertEqual(self.tree('<msup><mi>x</mi><mrow><mn>2</mn></mrow></msup>'),
                         self.tree('<mstyle><msup><mi mathvariant="italic">x</mi><mn>2</mn></msup></mstyle>'))

    def test_fraction_and_script_scope_stay_distinct(self):
        self.assertNotEqual(self.tree('<msup><mi>x</mi><mn>2</mn></msup><mi>y</mi>'),
                            self.tree('<msup><mi>x</mi><mrow><mn>2</mn><mi>y</mi></mrow></msup>'))
        self.assertNotEqual(self.tree('<mfrac><mi>a</mi><mi>b</mi></mfrac><mo>+</mo><mi>c</mi>'),
                            self.tree('<mfrac><mi>a</mi><mrow><mi>b</mi><mo>+</mo><mi>c</mi></mrow></mfrac>'))

    def test_superscript_subscript_and_bold_vector_are_distinct(self):
        self.assertNotEqual(self.tree('<msup><mi>x</mi><mn>2</mn></msup>'),
                            self.tree('<msub><mi>x</mi><mn>2</mn></msub>'))
        self.assertNotEqual(self.tree('<mi mathvariant="bold">a</mi>'),self.tree('<mi>a</mi>'))

    def test_render_errors_cannot_become_duplicate_keys(self):
        with self.assertRaises(ValueError):self.tree('<merror><mtext>bad</mtext></merror>')
        self.assertIsNone(comparison.native_key(r'设 \(broken\)',{'broken':None}))

    def test_numeric_punctuation_and_matrix_cells_do_not_collapse(self):
        self.assertNotEqual(comparison.plain('设长度1.5米'),comparison.plain('设长度15米'))
        self.assertNotEqual(comparison.plain('数对1,2'),comparison.plain('数对12'))
        self.assertEqual(self.tree('<mn>12</mn>'),self.tree('<mn>1</mn><mn>2</mn>'))
        self.assertNotEqual(self.tree('<mtable><mtr><mtd><mn>1</mn></mtd><mtd><mn>2</mn></mtd></mtr></mtable>'),
                            self.tree('<mtable><mtr><mtd><mn>12</mn></mtd></mtr></mtable>'))

    def test_tall_inline_matrix_keeps_chinese_reading_order(self):
        nodes=[{'kind':'formula','id':'matrix','bbox':[50,0,150,100]},
               {'kind':'text','text':'设','bbox':[0,42,20,58]},
               {'kind':'text','text':'则','bbox':[160,42,180,58]}]
        rows=assembly.ordered_lines(nodes)
        self.assertEqual([[n.get('text',n.get('id')) for n in row] for row in rows],[['设','matrix','则']])

    def test_missing_formula_never_receives_source_checked_status(self):
        class Resolver:
            def formula(self,fid):return {'id':fid,'text':'','status':'missing'}
        part=assembly.native_part([{'kind':'formula','id':'absent'}],Resolver())
        self.assertEqual(part['status'],'review-required')
        self.assertIn('待转写',part['text'])


if __name__=='__main__':unittest.main()
