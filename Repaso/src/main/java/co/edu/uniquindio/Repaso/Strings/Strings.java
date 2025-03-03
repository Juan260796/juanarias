package co.edu.uniquindio.Repaso.Strings;

public class Strings {
    public static void main(String[] args) {
        String str= new String();
        String str2= new String("hola");
        //Asignacion
        String str3= "hola";
        System.out.println(str3.equals(str2));
        System.out.println(str2.intern()==str3);



    }
}
