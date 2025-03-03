package co.edu.uniquindio.Repaso.Arreglos;

public class Arreglos {
    public static void main(String[] args) {
       /* int [] numeros= new int[10];
        numeros[3]= 38;
        System.out.println(numeros[3]);*/

        int [] numeros= {1,2,3,4,5,6,7,8,9,10};
        int[]copia;
        copia= numeros.clone();
        System.out.println(numeros[3]);
        System.out.println(copia[3]);

    }
}
